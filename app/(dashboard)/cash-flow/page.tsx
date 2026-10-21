import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { getCurrentOrgId } from "@/lib/org/current";
import { fetchIncomeStatement } from "@/lib/reports";
import { bookToday } from "@/lib/org/book-clock";
import { monthStart } from "@/lib/time/book-time";
import { TimezoneChangeNotice } from "@/components/ui/timezone-change-notice";
import { formatMoney } from "@/lib/money";
import { getBookCurrency } from "@/lib/org/book-currency";

export default async function CashFlowPage() {
  const orgId = await getCurrentOrgId();
  const currency = await getBookCurrency(orgId);
  const formatCurrency = (value: number) => formatMoney(value, currency);

  if (!orgId) {
    return (
      <div>
        <PageHeader title="Cash Flow" description="Inflows and outflows across your household accounts." />
        <p className="mt-4 text-sm text-slate-500">Select or create an organization first.</p>
      </div>
    );
  }

  const end = await bookToday(orgId);
  const start = monthStart(end);

  const statement = await fetchIncomeStatement(orgId, start, end);
  const inflows = statement
    .filter((r) => r.type === "revenue")
    .reduce((sum, r) => sum + r.amount, 0);
  const outflows = statement
    .filter((r) => r.type === "expense")
    .reduce((sum, r) => sum + r.amount, 0);
  const netCashFlow = inflows - outflows;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Cash Flow"
        description="Month-to-date inflows, outflows, and net household savings."
      />
      <TimezoneChangeNotice from={start} to={end} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Total Inflows (Income)</p>
          <p className="mt-2 text-2xl font-bold text-emerald-600">{formatCurrency(inflows)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Total Outflows (Spending)</p>
          <p className="mt-2 text-2xl font-bold text-slate-700">{formatCurrency(outflows)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Net Cash Flow</p>
          <p className={`mt-2 text-2xl font-bold ${netCashFlow >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
            {netCashFlow >= 0 ? "+" : ""}
            {formatCurrency(netCashFlow)}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-6">
        <h3 className="text-sm font-semibold text-slate-900 mb-4">Cash Flow Categories (MTD)</h3>
        {statement.length === 0 ? (
          <p className="text-xs text-slate-500">No transactions recorded for the current month.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {statement.map((row) => (
              <div key={row.account_id} className="flex items-center justify-between py-2 text-xs">
                <Link
                  href={`/reports/account/${row.account_id}?start=${start}&end=${end}&from=cashflow`}
                  className="font-medium text-slate-800 hover:underline"
                >
                  {row.name}
                </Link>
                <span
                  className={`font-mono font-semibold ${
                    row.type === "revenue" ? "text-emerald-600" : "text-slate-800"
                  }`}
                >
                  {row.type === "revenue" ? "+" : "-"}
                  {formatCurrency(row.amount)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
