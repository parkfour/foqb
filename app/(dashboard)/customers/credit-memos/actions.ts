"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/org/current";
import { findAccountsReceivableAccount } from "@/lib/org/control-accounts";
import { emitHook } from "@/lib/plugins/hooks";
import { ensureServerPluginsLoaded } from "@/lib/plugins/server-loader";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface CreditMemoInput {
  customerId: string;
  memoNumber: string;
  memoDate: string;
  reason: string;
  invoiceId: string | null;
  lines: { accountId: string; description: string; amount: number }[];
}

// An applied memo is a payment to plugins too (invoice_payment:recorded
// fires on every path that records one).
async function emitApplied(supabase: SupabaseClient, orgId: string, memoId: string): Promise<string | null> {
  const { data } = await supabase
    .from("invoice_payments")
    .select("id, invoice_id, invoices(status)")
    .eq("credit_memo_id", memoId)
    .maybeSingle();
  const payment = data as unknown as { id: string; invoice_id: string; invoices: { status: string } | null } | null;
  if (!payment) return null;
  ensureServerPluginsLoaded();
  await emitHook("invoice_payment:recorded", {
    paymentId: payment.id,
    invoiceId: payment.invoice_id,
    invoiceStatus: payment.invoices?.status ?? "partial",
    orgId,
  });
  return payment.invoice_id;
}

// Posts the memo (and applies it, when an invoice is picked) in one
// database call, create_credit_memo.
export async function createCreditMemo(input: CreditMemoInput): Promise<{ error: string | null }> {
  const orgId = await getCurrentOrgId();
  if (!orgId) return { error: "No book selected" };
  if (!input.customerId || !input.memoNumber.trim() || !input.memoDate) {
    return { error: "Customer, number and date are required" };
  }

  const supabase = await createClient();
  const ar = await findAccountsReceivableAccount(supabase, orgId);
  if ("error" in ar) return { error: ar.error };

  const { data: memoId, error } = await supabase.rpc("create_credit_memo", {
    p_org_id: orgId,
    p_customer_id: input.customerId,
    p_memo_number: input.memoNumber.trim(),
    p_memo_date: input.memoDate,
    p_reason: input.reason,
    p_lines: input.lines.map((l) => ({ account_id: l.accountId, description: l.description, amount: l.amount })),
    p_ar_account_id: ar.id,
    p_invoice_id: input.invoiceId,
  });
  if (error) return { error: error.message };

  const appliedTo = input.invoiceId ? await emitApplied(supabase, orgId, memoId as string) : null;
  ensureServerPluginsLoaded();
  await emitHook("credit_memo:created", {
    creditMemoId: memoId as string,
    memoNumber: input.memoNumber.trim(),
    customerId: input.customerId,
    total: Math.round(input.lines.reduce((sum, l) => sum + l.amount, 0) * 100) / 100,
    appliedToInvoiceId: appliedTo,
    orgId,
  });

  revalidatePath("/customers/credit-memos");
  revalidatePath("/customers/invoices");
  return { error: null };
}

export async function applyCreditMemo(formData: FormData): Promise<void> {
  const memoId = formData.get("memoId") as string;
  const invoiceId = formData.get("invoiceId") as string;
  if (!memoId || !invoiceId) return;

  const supabase = await createClient();
  const { error } = await supabase.rpc("apply_credit_memo", { p_credit_memo_id: memoId, p_invoice_id: invoiceId });
  if (error) throw new Error(error.message);
  const orgId = await getCurrentOrgId();
  if (orgId) await emitApplied(supabase, orgId, memoId);
  revalidatePath("/customers/credit-memos");
  revalidatePath("/customers/invoices");
}
