import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { emitHook } from "@/lib/plugins/hooks";
import { ensureServerPluginsLoaded } from "@/lib/plugins/server-loader";
import { findAccountsReceivableAccount } from "@/lib/org/control-accounts";

interface InvoicePaymentRequestBody {
  invoice_id: string;
  payment_date: string;
  amount: number;
  deposit_account_id: string;
  bank_transaction_id: string | null;
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Partial<InvoicePaymentRequestBody>;
  const { invoice_id, payment_date, bank_transaction_id } = body;
  const { amount, deposit_account_id } = body;

  if (!invoice_id || !payment_date) {
    return NextResponse.json(
      { error: "invoice and payment date are required" },
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

  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, organization_id, invoice_number, status, tax_amount")
    .eq("id", invoice_id)
    .maybeSingle();

  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("id")
    .eq("organization_id", invoice.organization_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const arAccount = await findAccountsReceivableAccount(supabase, invoice.organization_id);
  if ("error" in arAccount) {
    return NextResponse.json({ error: arAccount.error }, { status: 400 });
  }

  // Balance check, bank-transaction matching (which uses the bank
  // transaction's own amount and account, not client-supplied values),
  // posting and the invoice status update all happen in one transaction with
  // the invoice row locked — see 20260101000036_record_payments.sql.
  const { data, error } = await supabase.rpc("record_invoice_payment", {
    p_invoice_id: invoice_id,
    p_payment_date: payment_date,
    p_amount: amount ?? null,
    p_deposit_account_id: deposit_account_id ?? null,
    p_ar_account_id: arAccount.id,
    p_bank_transaction_id: bank_transaction_id ?? null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const result = data as { id: string; status: string };
  ensureServerPluginsLoaded();
  await emitHook("invoice_payment:recorded", {
    paymentId: result.id,
    invoiceId: invoice_id,
    invoiceStatus: result.status,
    orgId: invoice.organization_id,
  });
  return NextResponse.json({ success: true, id: result.id, status: result.status });
}
