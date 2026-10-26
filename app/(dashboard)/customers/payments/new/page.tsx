import { redirect } from "next/navigation";
import { ReceivePaymentForm } from "@/components/customers/receive-payment-form";
import { ReadOnlyNotice } from "@/components/ui/read-only-notice";
import { createClient } from "@/lib/supabase/server";
import { canWrite, getCurrentOrgId, getCurrentUserRole, getUseAccountCodes } from "@/lib/org/current";

export default async function ReceivePaymentPage() {
  const orgId = await getCurrentOrgId();

  if (!orgId) {
    redirect("/");
  }

  if (!canWrite(await getCurrentUserRole(orgId))) {
    return <ReadOnlyNotice />;
  }

  const supabase = await createClient();

  const [
    { data: customers },
    { data: invoices },
    { data: accounts },
    { data: bankTransactions },
    showAccountCodes,
  ] = await Promise.all([
      supabase
        .from("customers")
        .select("id, name")
        .eq("organization_id", orgId)
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("invoices")
        .select(
          "id, invoice_number, customer_id, tax_amount, invoice_lines(amount), invoice_payments(amount)",
        )
        .eq("organization_id", orgId)
        .in("status", ["open", "partial"])
        .order("invoice_date"),
      supabase
        .from("accounts")
        .select("id, account_number, name")
        .eq("organization_id", orgId)
        .eq("is_active", true)
        .is("currency", null)
        .eq("type", "asset")
        .order("account_number"),
      supabase
        .from("bank_transactions")
        .select("id, date, name, amount")
        .eq("organization_id", orgId)
        .eq("status", "unreconciled")
        .gt("amount", 0)
        .order("date", { ascending: false }),
      getUseAccountCodes(orgId),
    ]);

  interface RawInvoice {
    id: string;
    invoice_number: string;
    customer_id: string;
    tax_amount: number;
    invoice_lines: { amount: number }[];
    invoice_payments: { amount: number }[];
  }

  const openInvoices = ((invoices as unknown as RawInvoice[] | null) ?? []).map((invoice) => {
    const total =
      invoice.invoice_lines.reduce((sum, l) => sum + Number(l.amount), 0) +
      Number(invoice.tax_amount);
    const paid = invoice.invoice_payments.reduce((sum, p) => sum + Number(p.amount), 0);
    return {
      id: invoice.id,
      invoiceNumber: invoice.invoice_number,
      customerId: invoice.customer_id,
      remaining: Math.round((total - paid) * 100) / 100,
    };
  });

  return (
    <ReceivePaymentForm
      customers={customers ?? []}
      invoices={openInvoices}
      accounts={accounts ?? []}
      bankTransactions={bankTransactions ?? []}
      showAccountCodes={showAccountCodes}
    />
  );
}
