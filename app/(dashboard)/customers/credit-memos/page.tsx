import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { createClient } from "@/lib/supabase/server";
import { canWrite, getCurrentOrgId, getCurrentUserRole } from "@/lib/org/current";
import { formatMoney } from "@/lib/money";
import { getBookCurrency } from "@/lib/org/book-currency";
import { fetchOpenInvoices } from "@/lib/ar/open-invoices";
import { applyCreditMemo } from "./actions";

interface RawMemo {
  id: string;
  memo_number: string;
  memo_date: string;
  reason: string | null;
  total: number;
  customer_id: string;
  journal_entry_id: string;
  customers: { name: string } | null;
  invoice_payments: { invoice_id: string; invoices: { invoice_number: string } | null }[];
}

export default async function CreditMemosPage() {
  const orgId = await getCurrentOrgId();
  const description = "Credit given back to customers, applied to an invoice or held until one is.";
  if (!orgId) {
    return (
      <div>
        <PageHeader title="Credit Memos" description={description} />
        <p className="text-sm text-slate-500">Create an organization first.</p>
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data }, role, currency, invoices] = await Promise.all([
    supabase
      .from("credit_memos")
      .select("id, memo_number, memo_date, reason, total, customer_id, journal_entry_id, customers(name), invoice_payments(invoice_id, invoices(invoice_number))")
      .eq("organization_id", orgId)
      .order("memo_date", { ascending: false }),
    getCurrentUserRole(orgId),
    getBookCurrency(orgId),
    fetchOpenInvoices(supabase, orgId),
  ]);
  const memos = (data as unknown as RawMemo[] | null) ?? [];
  const formatCurrency = (value: number) => formatMoney(value, currency);
  const userCanWrite = canWrite(role);
  const unapplied = memos.filter((m) => m.invoice_payments.length === 0).reduce((s, m) => s + Number(m.total), 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <PageHeader title="Credit Memos" description={description} />
        {userCanWrite && (
          <Link
            href="/customers/credit-memos/new"
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            New Credit Memo
          </Link>
        )}
      </div>
      {unapplied > 0 && (
        <p className="text-sm text-slate-600">
          {formatCurrency(unapplied)} of credit not yet applied to an invoice. It already lowers Accounts Receivable.
        </p>
      )}

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">Number</th>
                <th className="px-5 py-3 font-medium">Customer</th>
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium">Reason</th>
                <th className="px-5 py-3 font-medium text-right">Credit</th>
                <th className="px-5 py-3 font-medium">Applied to</th>
              </tr>
            </thead>
            <tbody>
              {memos.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-6 text-center text-slate-500">
                    No credit memos yet.
                  </td>
                </tr>
              ) : (
                memos.map((m) => {
                  const applied = m.invoice_payments[0];
                  const candidates = invoices.filter((i) => i.customer_id === m.customer_id && i.remaining >= Number(m.total));
                  return (
                    <tr key={m.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-5 py-3 text-slate-900">
                        <Link href={`/journal/${m.journal_entry_id}`} className="hover:underline">
                          {m.memo_number}
                        </Link>
                      </td>
                      <td className="px-5 py-3 text-slate-600">{m.customers?.name ?? "—"}</td>
                      <td className="px-5 py-3 text-slate-600">{m.memo_date}</td>
                      <td className="px-5 py-3 text-slate-600">{m.reason ?? ""}</td>
                      <td className="px-5 py-3 text-right text-slate-900">{formatCurrency(Number(m.total))}</td>
                      <td className="px-5 py-3 text-slate-600">
                        {applied ? (
                          <Link href={`/customers/invoices/${applied.invoice_id}`} className="underline hover:text-slate-900">
                            Invoice {applied.invoices?.invoice_number}
                          </Link>
                        ) : userCanWrite && candidates.length > 0 ? (
                          <form action={applyCreditMemo} className="flex gap-2">
                            <input type="hidden" name="memoId" value={m.id} />
                            <select name="invoiceId" required className="rounded-md border border-slate-300 px-2 py-1 text-sm">
                              {candidates.map((i) => (
                                <option key={i.id} value={i.id}>
                                  {i.invoice_number} ({formatCurrency(i.remaining)} owed)
                                </option>
                              ))}
                            </select>
                            <button type="submit" className="text-sm font-medium text-slate-700 underline hover:text-slate-900">
                              Apply
                            </button>
                          </form>
                        ) : (
                          "Not yet applied"
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
