import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { emitHook } from "@/lib/plugins/hooks";
import { ensureServerPluginsLoaded } from "@/lib/plugins/server-loader";
import { findAccountsPayableAccount } from "@/lib/org/control-accounts";
import { fetchStockItems, recordMoves, updateAverageCosts, type StockMove } from "@/lib/ar/stock";

// Posts a bill: its journal entry, then the a bill itself, undoing the entry if
// anything after it fails. The caller has already checked who may do this:
// the API route for a signed-in member, the recurring job for a template.
export interface BillInput {
  organization_id: string;
  vendor_id: string;
  bill_number: string;
  bill_date: string;
  due_date: string | null;
  // item_id: an item that is stock goes to its inventory account, whatever
  // account_id says, and adds to its count.
  lines: { item_id?: string | null; account_id: string; description: string; quantity: number; unit_price: number }[];
  // A class (migration 089) for the expense lines.
  class_id?: string | null;
}

export type PostResult = { id: string; journalEntryId: string } | { error: string; status: number };

export async function createBill(
  supabase: SupabaseClient,
  input: BillInput,
  createdBy: string | null,
): Promise<PostResult> {
  const { organization_id, vendor_id, bill_number, bill_date, due_date, lines } = input;

  const stock = await fetchStockItems(supabase, organization_id, lines.map((l) => l.item_id ?? null));
  const computedLines = lines.map((line) => ({
    item_id: line.item_id ?? null,
    account_id: (line.item_id && stock.get(line.item_id)?.inventory_account_id) || line.account_id,
    description: line.description ?? "",
    quantity: line.quantity,
    unit_price: line.unit_price,
    amount: Math.round(line.quantity * line.unit_price * 100) / 100,
  }));

  if (computedLines.some((l) => !l.account_id || l.amount <= 0)) {
    return { error: "Every line needs an account and a positive amount", status: 400 };
  }

  const total = computedLines.reduce((sum, l) => sum + l.amount, 0);

  const apAccount = await findAccountsPayableAccount(supabase, organization_id);
  if ("error" in apAccount) {
    return { error: apAccount.error, status: 400 };
  }

  const entryId = randomUUID();

  const { error: entryError } = await supabase.from("journal_entries").insert({
    id: entryId,
    organization_id,
    entry_date: bill_date,
    memo: `Bill ${bill_number}`,
    status: "draft",
    created_by: createdBy,
  });

  if (entryError) {
    return { error: entryError.message, status: 500 };
  }

  const { error: linesError } = await supabase.from("journal_lines").insert([
    ...computedLines.map((l) => ({
      journal_entry_id: entryId,
      account_id: l.account_id,
      debit: l.amount,
      credit: 0,
      class_id: input.class_id || null,
    })),
    { journal_entry_id: entryId, account_id: apAccount.id, debit: 0, credit: total },
  ]);

  if (linesError) {
    await supabase.from("journal_entries").delete().eq("id", entryId);
    return { error: linesError.message, status: 500 };
  }

  const { error: postError } = await supabase
    .from("journal_entries")
    .update({ status: "posted" })
    .eq("id", entryId);

  if (postError) {
    await supabase.from("journal_entries").delete().eq("id", entryId);
    return { error: postError.message, status: 500 };
  }

  const bought: StockMove[] = computedLines
    .filter((l) => l.item_id && stock.has(l.item_id))
    .map((l) => ({ item_id: l.item_id as string, quantity: l.quantity, unit_cost: l.unit_price }));
  const movesError = await recordMoves(supabase, organization_id, entryId, bought);
  if (movesError) {
    await supabase.from("journal_entries").delete().eq("id", entryId);
    return { error: movesError, status: 500 };
  }
  await updateAverageCosts(supabase, stock, bought);

  const billId = randomUUID();

  const { error: billError } = await supabase.from("bills").insert({
    id: billId,
    organization_id,
    vendor_id,
    bill_number,
    bill_date,
    due_date: due_date || null,
    status: "open",
    journal_entry_id: entryId,
  });

  if (billError) {
    await supabase.from("journal_entries").delete().eq("id", entryId);
    return { error: billError.message, status: 500 };
  }

  const { error: billLinesError } = await supabase.from("bill_lines").insert(
    computedLines.map((l) => ({
      bill_id: billId,
      item_id: l.item_id,
      description: l.description,
      account_id: l.account_id,
      quantity: l.quantity,
      unit_price: l.unit_price,
      amount: l.amount,
    })),
  );

  if (billLinesError) {
    await supabase.from("bills").delete().eq("id", billId);
    await supabase.from("journal_entries").delete().eq("id", entryId);
    return { error: billLinesError.message, status: 500 };
  }

  ensureServerPluginsLoaded();
  await emitHook("bill:created", {
    billId,
    billNumber: bill_number,
    vendorId: vendor_id ?? null,
    total,
    orgId: organization_id,
  });

  return { id: billId, journalEntryId: entryId };
}
