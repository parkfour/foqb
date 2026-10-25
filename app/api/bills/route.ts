import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { emitHook } from "@/lib/plugins/hooks";
import { ensureServerPluginsLoaded } from "@/lib/plugins/server-loader";
import { findAccountsPayableAccount } from "@/lib/org/control-accounts";

interface BillLineInput {
  account_id: string;
  description: string;
  quantity: number;
  unit_price: number;
}

interface BillRequestBody {
  organization_id: string;
  vendor_id: string;
  bill_number: string;
  bill_date: string;
  due_date: string | null;
  lines: BillLineInput[];
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Partial<BillRequestBody>;
  const { organization_id, vendor_id, bill_number, bill_date, due_date, lines } = body;

  if (
    !organization_id ||
    !vendor_id ||
    !bill_number ||
    !bill_date ||
    !Array.isArray(lines) ||
    lines.length === 0
  ) {
    return NextResponse.json(
      { error: "vendor, bill number, bill date, and at least one line are required" },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("id")
    .eq("organization_id", organization_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const computedLines = lines.map((line) => ({
    account_id: line.account_id,
    description: line.description ?? "",
    quantity: line.quantity,
    unit_price: line.unit_price,
    amount: Math.round(line.quantity * line.unit_price * 100) / 100,
  }));

  if (computedLines.some((l) => !l.account_id || l.amount <= 0)) {
    return NextResponse.json(
      { error: "Every line needs an account and a positive amount" },
      { status: 400 },
    );
  }

  const total = computedLines.reduce((sum, l) => sum + l.amount, 0);

  const apAccount = await findAccountsPayableAccount(supabase, organization_id);
  if ("error" in apAccount) {
    return NextResponse.json({ error: apAccount.error }, { status: 400 });
  }

  const entryId = randomUUID();

  const { error: entryError } = await supabase.from("journal_entries").insert({
    id: entryId,
    organization_id,
    entry_date: bill_date,
    memo: `Bill ${bill_number}`,
    status: "draft",
    created_by: user.id,
  });

  if (entryError) {
    return NextResponse.json({ error: entryError.message }, { status: 500 });
  }

  const { error: linesError } = await supabase.from("journal_lines").insert([
    ...computedLines.map((l) => ({
      journal_entry_id: entryId,
      account_id: l.account_id,
      debit: l.amount,
      credit: 0,
    })),
    { journal_entry_id: entryId, account_id: apAccount.id, debit: 0, credit: total },
  ]);

  if (linesError) {
    await supabase.from("journal_entries").delete().eq("id", entryId);
    return NextResponse.json({ error: linesError.message }, { status: 500 });
  }

  const { error: postError } = await supabase
    .from("journal_entries")
    .update({ status: "posted" })
    .eq("id", entryId);

  if (postError) {
    await supabase.from("journal_entries").delete().eq("id", entryId);
    return NextResponse.json({ error: postError.message }, { status: 500 });
  }

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
    return NextResponse.json({ error: billError.message }, { status: 500 });
  }

  const { error: billLinesError } = await supabase.from("bill_lines").insert(
    computedLines.map((l) => ({
      bill_id: billId,
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
    return NextResponse.json({ error: billLinesError.message }, { status: 500 });
  }

  ensureServerPluginsLoaded();
  await emitHook("bill:created", {
    billId,
    billNumber: bill_number,
    vendorId: vendor_id ?? null,
    total,
    orgId: organization_id,
  });

  return NextResponse.json({ success: true, id: billId, journal_entry_id: entryId });
}
