import Link from "next/link";
import { VoidButton } from "@/components/ui/void-button";
import { PageHeader } from "@/components/ui/page-header";
import { createClient } from "@/lib/supabase/server";
import { canWrite, getCurrentOrgId, getCurrentUserRole } from "@/lib/org/current";
import { voidInvoice } from "../actions";
import { formatMoney } from "@/lib/money";
import { getBookCurrency } from "@/lib/org/book-currency";

interface RawInvoice {
  id: string;
  invoice_number: string;
  invoice_date: string;
  status: "open" | "partial" | "paid" | "void";
  tax_amount: number;
  customers: { name: string } | null;
  invoice_lines: { amount: number }[];
  invoice_payments: { amount: number }[];
}

const STATUS_STYLES: Record<string, string> = {
  open: "bg-amber-100 text-amber-800",
  partial: "bg-sky-100 text-sky-800",
  paid: "bg-emerald-100 text-emerald-800",
  void: "bg-slate-100 text-slate-600",
};

export default async function InvoicesListPage() {
  const orgId = await getCurrentOrgId();
  const currency = await getBookCurrency(orgId);
  const formatCurrency = (value: number) => formatMoney(value, currency);

  if (!orgId) {
    return (
      <div>
        <PageHeader title="Invoices" description="All customer invoices and their status." />
        <p className="text-sm text-slate-500">Create an organization first.</p>
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data }, role] = await Promise.all([
    supabase
      .from("invoices")
      .select(
        "id, invoice_number, invoice_date, status, tax_amount, customers(name), invoice_lines(amount), invoice_payments(amount)",
      )
      .eq("organization_id", orgId)
      .order("invoice_date", { ascending: false }),
    getCurrentUserRole(orgId),
  ]);

  const invoices = (data as unknown as RawInvoice[] | null) ?? [];
  const userCanWrite = canWrite(role);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <PageHeader title="Invoices" description="All customer invoices and their status." />
        {userCanWrite && (
          <Link
            href="/customers/invoices/new"
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            New Invoice
          </Link>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">Number</th>
                <th className="px-5 py-3 font-medium">Customer</th>
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium">Total</th>
                <th className="px-5 py-3 font-medium">Remaining</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {invoices.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-6 text-center text-slate-500">
                    No invoices yet.
                  </td>
                </tr>
              ) : (
                invoices.map((invoice) => {
                  const total =
                    invoice.invoice_lines.reduce((sum, l) => sum + Number(l.amount), 0) +
                    Number(invoice.tax_amount);
                  const paid = invoice.invoice_payments.reduce((sum, p) => sum + Number(p.amount), 0);
                  const remaining = Math.round((total - paid) * 100) / 100;

                  return (
                    <tr key={invoice.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-5 py-3 text-slate-900">
                        <Link
                          href={`/customers/invoices/${invoice.id}`}
                          className="hover:underline"
                        >
                          {invoice.invoice_number}
                        </Link>
                      </td>
                      <td className="px-5 py-3 text-slate-600">{invoice.customers?.name ?? "—"}</td>
                      <td className="px-5 py-3 text-slate-600">{invoice.invoice_date}</td>
                      <td className="px-5 py-3 text-slate-600">{formatCurrency(total)}</td>
                      <td className="px-5 py-3 text-slate-600">
                        {invoice.status === "void" ? "—" : formatCurrency(remaining)}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[invoice.status]}`}
                        >
                          {invoice.status}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        {userCanWrite && invoice.status !== "void" && (
                          <VoidButton
                            id={invoice.id}
                            action={voidInvoice}
                            warning={
                              invoice.invoice_payments.length > 0
                                ? "Its payments are undone too, and their bank transactions go back to the feed."
                                : undefined
                            }
                          />
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
