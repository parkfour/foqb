import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { TimeEntryForm } from "@/components/time/time-entry-form";
import { InvoiceTimeForm } from "@/components/time/invoice-time-form";
import { createClient } from "@/lib/supabase/server";
import { canWrite, getCurrentOrgId, getCurrentUserRole } from "@/lib/org/current";
import { bookToday } from "@/lib/org/book-clock";
import { formatMoney } from "@/lib/money";
import { getBookCurrency } from "@/lib/org/book-currency";
import { isUnbilled, timeInvoiceLines, type UnbilledEntry } from "@/lib/ar/time";
import { deleteTimeEntry } from "./actions";

interface EntryRow extends UnbilledEntry {
  billable: boolean;
  customer_id: string | null;
  invoice_id: string | null;
  customers: { name: string } | null;
}

const shiftMonth = (month: string, by: number) => {
  const d = new Date(`${month}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + by);
  return d.toISOString().slice(0, 7);
};

export default async function TimePage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const orgId = await getCurrentOrgId();
  const description = "Hours worked, by customer and service, and invoicing the billable ones.";
  if (!orgId) {
    return (
      <div>
        <PageHeader title="Time" description={description} />
        <p className="text-sm text-slate-500">Create an organization first.</p>
      </div>
    );
  }

  const today = await bookToday(orgId);
  const requested = (await searchParams).month;
  const month = requested && /^\d{4}-\d{2}$/.test(requested) ? requested : today.slice(0, 7);
  const supabase = await createClient();
  const select =
    "id, work_date, hours, description, rate, billable, customer_id, item_id, invoice_id, customers(name), items(name, income_account_id, sale_price), invoices(status)";
  const [{ data: monthData }, { data: unbilledData }, { data: customers }, { data: items }, role, currency] = await Promise.all([
    supabase
      .from("time_entries")
      .select(select)
      .eq("organization_id", orgId)
      .gte("work_date", `${month}-01`)
      .lt("work_date", `${shiftMonth(month, 1)}-01`)
      .order("work_date", { ascending: false }),
    supabase.from("time_entries").select(select).eq("organization_id", orgId).eq("billable", true).not("customer_id", "is", null),
    supabase.from("customers").select("id, name").eq("organization_id", orgId).eq("is_active", true).order("name"),
    supabase.from("items").select("id, name").eq("organization_id", orgId).eq("is_active", true).eq("track_quantity", false).order("name"),
    getCurrentUserRole(orgId),
    getBookCurrency(orgId),
  ]);
  const entries = (monthData as unknown as EntryRow[] | null) ?? [];
  const formatCurrency = (value: number) => formatMoney(value, currency);
  const userCanWrite = canWrite(role);

  // Unbilled billable hours by customer, whatever month they're in.
  const byCustomer = new Map<string, { name: string; hours: number; amount: number }>();
  for (const e of ((unbilledData as unknown as EntryRow[] | null) ?? []).filter(isUnbilled)) {
    const row = byCustomer.get(e.customer_id as string) ?? { name: e.customers?.name ?? "—", hours: 0, amount: 0 };
    row.hours += Number(e.hours);
    row.amount += timeInvoiceLines([e]).lines.reduce((s, l) => s + l.quantity * l.unit_price, 0);
    byCustomer.set(e.customer_id as string, row);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Time" description={description} />

      {userCanWrite && (
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Log time</h2>
          <TimeEntryForm customers={customers ?? []} items={items ?? []} />
        </div>
      )}

      {byCustomer.size > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <h2 className="border-b border-slate-200 px-5 py-3 text-sm font-semibold text-slate-900">Unbilled hours</h2>
          <table className="w-full text-sm">
            <tbody>
              {[...byCustomer.entries()].map(([customerId, row]) => (
                <tr key={customerId} className="border-b border-slate-100 last:border-0">
                  <td className="px-5 py-3 text-slate-900">{row.name}</td>
                  <td className="px-5 py-3 text-right text-slate-600">{row.hours} h</td>
                  <td className="px-5 py-3 text-right text-slate-900">{formatCurrency(row.amount)}</td>
                  <td className="px-5 py-3">{userCanWrite && <InvoiceTimeForm customerId={customerId} today={today} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 text-sm">
          <Link href={`/time?month=${shiftMonth(month, -1)}`} className="underline hover:text-slate-900">
            ← {shiftMonth(month, -1)}
          </Link>
          <span className="font-semibold text-slate-900">
            {month}: {entries.reduce((s, e) => s + Number(e.hours), 0)} h
          </span>
          <Link href={`/time?month=${shiftMonth(month, 1)}`} className="underline hover:text-slate-900">
            {shiftMonth(month, 1)} →
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium">Customer</th>
                <th className="px-5 py-3 font-medium">Work</th>
                <th className="px-5 py-3 font-medium text-right">Hours</th>
                <th className="px-5 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-6 text-center text-slate-500">
                    No time logged in {month}.
                  </td>
                </tr>
              ) : (
                entries.map((e) => (
                  <tr key={e.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-5 py-3 text-slate-600">{e.work_date}</td>
                    <td className="px-5 py-3 text-slate-600">{e.customers?.name ?? "—"}</td>
                    <td className="px-5 py-3 text-slate-900">
                      {[e.items?.name, e.description].filter(Boolean).join(": ") || "—"}
                      {!e.billable && <span className="ml-2 text-xs text-slate-500">not billable</span>}
                    </td>
                    <td className="px-5 py-3 text-right text-slate-900">{Number(e.hours)}</td>
                    <td className="px-5 py-3 text-right">
                      {e.invoice_id && !isUnbilled(e) ? (
                        <Link href={`/customers/invoices/${e.invoice_id}`} className="text-sm text-slate-500 underline">
                          Invoiced
                        </Link>
                      ) : (
                        userCanWrite && (
                          <form action={deleteTimeEntry}>
                            <input type="hidden" name="id" value={e.id} />
                            <button type="submit" className="text-sm text-slate-400 hover:text-red-600">
                              Delete
                            </button>
                          </form>
                        )
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
