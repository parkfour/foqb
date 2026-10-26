import { PageHeader } from "@/components/ui/page-header";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/org/current";
import { bookToday } from "@/lib/org/book-clock";
import { addDays } from "@/lib/time/book-time";
import { formatMoney } from "@/lib/money";
import { getBookCurrency } from "@/lib/org/book-currency";
import { readAllRows } from "@/lib/supabase/read-all";
import { detectRecurring, type FeedCharge } from "@/lib/subscriptions/detect";

const CADENCE_LABELS = { weekly: "Weekly", monthly: "Monthly", yearly: "Yearly" } as const;

export default async function SubscriptionsPage() {
  const orgId = await getCurrentOrgId();
  const description = "Charges that come back on a schedule, found in the bank feed.";
  if (!orgId) {
    return (
      <div>
        <PageHeader title="Recurring Charges" description={description} />
        <p className="text-sm text-slate-500">Create an organization first.</p>
      </div>
    );
  }

  const today = await bookToday(orgId);
  const supabase = await createClient();
  // Thirteen months: enough to see a yearly renewal twice.
  const [charges, currency] = await Promise.all([
    readAllRows<FeedCharge>((from, to) =>
      supabase
        .from("bank_transactions")
        .select("date, name, amount")
        .eq("organization_id", orgId)
        .lt("amount", 0)
        .neq("status", "ignored")
        .gte("date", addDays(today, -400))
        .order("date")
        .order("id")
        .range(from, to),
    ),
    getBookCurrency(orgId),
  ]);
  const found = detectRecurring(charges);
  // Still going: seen within one rhythm (and a bit) of today.
  const active = found.filter((r) => r.next >= addDays(today, -10));
  const stopped = found.filter((r) => r.next < addDays(today, -10));
  const formatCurrency = (value: number) => formatMoney(value, currency);
  const total = active.reduce((s, r) => s + r.perYear, 0);

  const table = (rows: typeof found, empty: string) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="px-5 py-3 font-medium">Merchant</th>
            <th className="px-5 py-3 font-medium">How often</th>
            <th className="px-5 py-3 text-right font-medium">Usually</th>
            <th className="px-5 py-3 font-medium">Last</th>
            <th className="px-5 py-3 font-medium">Next</th>
            <th className="px-5 py-3 text-right font-medium">A year</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-5 py-6 text-center text-slate-500">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.merchant} className="border-b border-slate-100 last:border-0">
                <td className="px-5 py-3 text-slate-900">
                  <a href={`/transactions?search=${encodeURIComponent(r.merchant)}`} className="hover:underline">
                    {r.merchant}
                  </a>
                  <span className="block text-xs text-slate-500">{r.count} charges</span>
                </td>
                <td className="px-5 py-3 text-slate-600">{CADENCE_LABELS[r.cadence]}</td>
                <td className="px-5 py-3 text-right text-slate-900">{formatCurrency(r.typical)}</td>
                <td className="px-5 py-3 text-slate-600">{r.last}</td>
                <td className="px-5 py-3 text-slate-600">{r.next}</td>
                <td className="px-5 py-3 text-right font-medium text-slate-900">{formatCurrency(r.perYear)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Recurring Charges" description={description} />
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Still going, a year</p>
        <p className="mt-2 text-2xl font-bold text-slate-900">{formatCurrency(total)}</p>
        <p className="mt-1 text-xs text-slate-500">
          {active.length} recurring charge{active.length === 1 ? "" : "s"}: the same merchant, a steady amount, weekly, monthly
          or yearly.
        </p>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">{table(active, "No recurring charges found in the last 13 months.")}</div>
      {stopped.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <h2 className="border-b border-slate-200 px-5 py-3 text-sm font-semibold text-slate-900">Seem to have stopped</h2>
          {table(stopped, "")}
        </div>
      )}
    </div>
  );
}
