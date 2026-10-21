import { createClient } from "@/lib/supabase/server";
import { fetchIncomeStatement, fetchBalanceSheet } from "@/lib/reports";
import { getCurrentOrgId, getWorkspaceType } from "@/lib/org/current";
import { CreateOrRestoreOrg } from "@/components/onboarding/create-or-restore-org";
import { YoyComparison, type MonthComparison } from "@/components/dashboard/yoy-comparison";
import { PersonalWealthDashboard } from "@/components/dashboard/personal-wealth-dashboard";
import { calculateHouseholdNetWorth, fetchNetWorthHistory, withTodaysPoint } from "@/lib/net-worth/engine";
import { calculateUserBusinessEquity } from "@/lib/org/equity-rollup";
import { bookToday } from "@/lib/org/book-clock";
import { monthStart } from "@/lib/time/book-time";
import { TimezoneChangeNotice } from "@/components/ui/timezone-change-notice";
import { formatMoney } from "@/lib/money";
import { getBookCurrency } from "@/lib/org/book-currency";

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Plain calendar dates: day 0 of the next month is this month's last day.
function monthRange(year: number, monthIndex: number): { start: string; end: string } {
  const start = new Date(Date.UTC(year, monthIndex, 1));
  const end = new Date(Date.UTC(year, monthIndex + 1, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

// 24 parallel RPC calls (12 months x 2 years) against the already-tested
// get_income_statement RPC — no dedicated monthly-rollup function exists
// yet. Fine at 0.1/small-org scale; upgrade path is a rollup RPC if this
// becomes a bottleneck.
async function fetchYoyComparison(orgId: string, today: string): Promise<{
  data: MonthComparison[];
  thisYear: number;
  lastYear: number;
}> {
  const thisYear = Number(today.slice(0, 4));
  const lastYear = thisYear - 1;

  const monthlyTotals = async (year: number) =>
    Promise.all(
      MONTH_LABELS.map(async (_, monthIndex) => {
        const { start, end } = monthRange(year, monthIndex);
        const rows = await fetchIncomeStatement(orgId, start, end);
        const income = rows.filter((r) => r.type === "revenue").reduce((s, r) => s + r.amount, 0);
        const expense = rows.filter((r) => r.type === "expense").reduce((s, r) => s + r.amount, 0);
        return { income, expense };
      }),
    );

  const [thisYearTotals, lastYearTotals] = await Promise.all([
    monthlyTotals(thisYear),
    monthlyTotals(lastYear),
  ]);

  const data: MonthComparison[] = MONTH_LABELS.map((month, i) => ({
    month,
    thisYearIncome: thisYearTotals[i].income,
    thisYearExpense: thisYearTotals[i].expense,
    lastYearIncome: lastYearTotals[i].income,
    lastYearExpense: lastYearTotals[i].expense,
  }));

  return { data, thisYear, lastYear };
}

interface RecentTransaction {
  id: string;
  date: string;
  name: string | null;
  amount: number;
  status: "unreconciled" | "matched" | "ignored";
}

export default async function DashboardPage() {
  const orgId = await getCurrentOrgId();
  const currency = await getBookCurrency(orgId);
  const formatCurrency = (value: number) => formatMoney(value, currency);

  if (!orgId) {
    return <CreateOrRestoreOrg />;
  }

  const workspaceType = await getWorkspaceType(orgId);

  if (workspaceType === "household") {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const today = await bookToday(orgId);
    const [netWorthData, history, businessEquityRollup] = await Promise.all([
      calculateHouseholdNetWorth(orgId, today, supabase),
      fetchNetWorthHistory(orgId, "1Y", today, supabase),
      user?.id ? calculateUserBusinessEquity(user.id, supabase, currency) : Promise.resolve({ businesses: [], totalBusinessEquity: 0 }),
    ]);

    return (
      <>
      <TimezoneChangeNotice from={today} />
      <PersonalWealthDashboard
        data={netWorthData}
        history={withTodaysPoint(history, netWorthData)}
        businessEquity={{
          total: businessEquityRollup.totalBusinessEquity,
          businesses: businessEquityRollup.businesses.map((b) => ({
            id: b.organizationId,
            name: b.organizationName,
            equity: b.bookEquity,
          })),
        }}
      />
      </>
    );
  }

  const end = await bookToday(orgId);
  const start = monthStart(end);

  const [incomeStatement, balanceSheet, yoyComparison] = await Promise.all([
    fetchIncomeStatement(orgId, start, end),
    fetchBalanceSheet(orgId, end),
    fetchYoyComparison(orgId, end),
  ]);

  const revenue = incomeStatement
    .filter((row) => row.type === "revenue")
    .reduce((sum, row) => sum + row.amount, 0);
  const expenses = incomeStatement
    .filter((row) => row.type === "expense")
    .reduce((sum, row) => sum + row.amount, 0);
  const netIncome = revenue - expenses;

  const cashOnHand = balanceSheet
    .filter((row) => row.type === "asset")
    .reduce((sum, row) => sum + row.balance, 0);

  const supabase = await createClient();

  const [{ count: unreconciledCount }, { data: recentTransactions }] = await Promise.all([
    supabase
      .from("bank_transactions")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("status", "unreconciled"),
    supabase
      .from("bank_transactions")
      .select("id, date, name, amount, status")
      .eq("organization_id", orgId)
      .order("date", { ascending: false })
      .limit(5),
  ]);

  const transactions = (recentTransactions as RecentTransaction[] | null) ?? [];

  const cards = [
    { label: "Cash on Hand", value: formatCurrency(cashOnHand) },
    { label: "Net Income", value: formatCurrency(netIncome) },
    { label: "Total Expenses", value: formatCurrency(expenses) },
    { label: "Unreconciled Transactions", value: String(unreconciledCount ?? 0) },
  ];

  return (
    <div className="flex flex-col gap-6">
      <TimezoneChangeNotice from={start} to={end} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <div
            key={card.label}
            className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
          >
            <p className="text-sm font-medium text-slate-500">{card.label}</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{card.value}</p>
          </div>
        ))}
      </div>

      <YoyComparison
        data={yoyComparison.data}
        thisYear={yoyComparison.thisYear}
        lastYear={yoyComparison.lastYear}
      />

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900">Recent Transactions</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium">Description</th>
                <th className="px-5 py-3 font-medium">Amount</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {transactions.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-5 py-6 text-center text-slate-500">
                    No transactions yet.
                  </td>
                </tr>
              ) : (
                transactions.map((tx) => (
                  <tr key={tx.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-5 py-3 text-slate-600">{tx.date}</td>
                    <td className="px-5 py-3 text-slate-900">{tx.name ?? "—"}</td>
                    <td className="px-5 py-3 text-slate-900">{formatCurrency(tx.amount)}</td>
                    <td className="px-5 py-3">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                          tx.status === "matched"
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {tx.status}
                      </span>
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
