import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/org/current";
import { bookToday } from "@/lib/org/book-clock";
import { addDays } from "@/lib/time/book-time";
import { formatMoney } from "@/lib/money";
import { getBookCurrency } from "@/lib/org/book-currency";
import { buildStatement, fetchStatementInvoices } from "@/lib/ar/statement";
import { PluginSlot } from "@/components/plugins/plugin-slot";
import { PrintButton } from "@/components/ui/print-button";

export default async function CustomerStatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ start?: string; end?: string }>;
}) {
  const { id } = await params;
  const orgId = await getCurrentOrgId();
  if (!orgId) redirect("/");

  const today = await bookToday(orgId);
  const sp = await searchParams;
  const valid = (d: string | undefined) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);
  const end = valid(sp.end) ?? today;
  const start = valid(sp.start) ?? addDays(end, -89);

  const supabase = await createClient();
  const [{ data: customer }, { data: org }, invoices, currency] = await Promise.all([
    supabase.from("customers").select("id, name, email, billing_address").eq("id", id).eq("organization_id", orgId).maybeSingle(),
    supabase.from("organizations").select("name, logo_data_url").eq("id", orgId).maybeSingle(),
    fetchStatementInvoices(supabase, orgId, id),
    getBookCurrency(orgId),
  ]);
  if (!customer) notFound();
  const formatCurrency = (value: number) => formatMoney(value, currency);

  const statement = buildStatement(invoices, start, end);
  const overdue = invoices
    .map((i) => ({ ...i, owed: Math.round((i.total - i.payments.filter((p) => p.payment_date <= end).reduce((s, p) => s + p.amount, 0)) * 100) / 100 }))
    .filter((i) => i.owed > 0 && i.due_date && i.due_date < end && i.invoice_date <= end);
  const o = org as { name: string; logo_data_url: string | null } | null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <form className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            From
            <input type="date" name="start" defaultValue={start} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            To
            <input type="date" name="end" defaultValue={end} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <button type="submit" className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">
            Show
          </button>
        </form>
        <div className="flex items-center gap-4">
          <Link href={`/customers/${id}`} className="text-sm text-slate-600 underline hover:text-slate-900">
            ← {customer.name}
          </Link>
          <PluginSlot
            name="statement.actions"
            context={{
              customerId: id,
              customer: { name: customer.name as string, email: (customer.email as string | null) ?? null },
              start,
              end,
              amountDue: statement.closing,
            }}
          />
          <PrintButton label="Print or save as PDF" />
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-8 shadow-sm print:border-0 print:p-0 print:shadow-none">
        <div className="flex items-start justify-between">
          <div>
            {o?.logo_data_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={o.logo_data_url} alt="" className="mb-2 h-12" />
            )}
            <p className="text-lg font-semibold text-slate-900">{o?.name}</p>
          </div>
          <div className="text-right">
            <p className="text-xl font-semibold text-slate-900">Statement</p>
            <p className="text-sm text-slate-600">
              {start} to {end}
            </p>
          </div>
        </div>
        <div className="mt-6 text-sm text-slate-700">
          <p className="font-medium text-slate-900">{customer.name}</p>
          {customer.billing_address && <p className="whitespace-pre-line">{customer.billing_address}</p>}
        </div>

        <table className="mt-6 w-full text-sm">
          <thead>
            <tr className="border-b border-slate-300 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="py-2 font-medium">Date</th>
              <th className="py-2 font-medium">Activity</th>
              <th className="py-2 text-right font-medium">Amount</th>
              <th className="py-2 text-right font-medium">Balance</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-slate-100 text-slate-600">
              <td className="py-2">{start}</td>
              <td className="py-2">Balance forward</td>
              <td />
              <td className="py-2 text-right">{formatCurrency(statement.opening)}</td>
            </tr>
            {statement.lines.map((l, i) => (
              <tr key={i} className="border-b border-slate-100">
                <td className="py-2 text-slate-600">{l.date}</td>
                <td className="py-2 text-slate-900">
                  <Link href={`/customers/invoices/${l.invoiceId}`} className="hover:underline">
                    {l.label}
                  </Link>
                </td>
                <td className="py-2 text-right text-slate-900">{formatCurrency(l.amount)}</td>
                <td className="py-2 text-right text-slate-900">{formatCurrency(l.balance)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td colSpan={3} className="pt-3">
                Amount due
              </td>
              <td className="pt-3 text-right">{formatCurrency(statement.closing)}</td>
            </tr>
          </tfoot>
        </table>

        {overdue.length > 0 && (
          <div className="mt-6 text-sm">
            <p className="font-medium text-slate-900">Past due on {end}</p>
            <ul className="mt-1 text-slate-700">
              {overdue.map((i) => (
                <li key={i.id}>
                  Invoice {i.invoice_number}, due {i.due_date}: {formatCurrency(i.owed)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
