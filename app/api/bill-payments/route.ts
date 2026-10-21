import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { emitHook } from "@/lib/plugins/hooks";
import { ensureServerPluginsLoaded } from "@/lib/plugins/server-loader";
import { findAccountsPayableAccount } from "@/lib/org/control-accounts";

interface BillPaymentRequestBody {
  bill_id: string;
  payment_date: string;
  amount: number;
  payment_account_id: string;
  bank_transaction_id: string | null;
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Partial<BillPaymentRequestBody>;
  const { bill_id, payment_date, bank_transaction_id } = body;
  const { amount, payment_account_id } = body;

  if (!bill_id || !payment_date) {
    return NextResponse.json({ error: "bill and payment date are required" }, { status: 400 });
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: bill } = await supabase
    .from("bills")
    .select("id, organization_id, bill_number, status")
    .eq("id", bill_id)
    .maybeSingle();

  if (!bill) {
    return NextResponse.json({ error: "Bill not found" }, { status: 404 });
  }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("id")
    .eq("organization_id", bill.organization_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const apAccount = await findAccountsPayableAccount(supabase, bill.organization_id);
  if ("error" in apAccount) {
    return NextResponse.json({ error: apAccount.error }, { status: 400 });
  }

  // Balance check, bank-transaction matching (which uses the bank
  // transaction's own amount and account, not client-supplied values),
  // posting and the bill status update all happen in one transaction with
  // the bill row locked — see 20260101000036_record_payments.sql.
  const { data, error } = await supabase.rpc("record_bill_payment", {
    p_bill_id: bill_id,
    p_payment_date: payment_date,
    p_amount: amount ?? null,
    p_payment_account_id: payment_account_id ?? null,
    p_ap_account_id: apAccount.id,
    p_bank_transaction_id: bank_transaction_id ?? null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const result = data as { id: string; status: string };
  ensureServerPluginsLoaded();
  await emitHook("bill_payment:recorded", {
    paymentId: result.id,
    billId: bill_id,
    billStatus: result.status,
    orgId: bill.organization_id,
  });
  return NextResponse.json({ success: true, id: result.id, status: result.status });
}
