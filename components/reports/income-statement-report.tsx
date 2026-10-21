import Link from "next/link";
import { fetchIncomeStatement } from "@/lib/reports";
import { formatAccountLabel } from "@/lib/accounts/format";
import { getUseAccountCodes } from "@/lib/org/current";
import { formatMoney } from "@/lib/money";
import { getBookCurrency } from "@/lib/org/book-currency";

export async function IncomeStatementReport({
  orgId,
  start,
  end,
}: {
  orgId: string;
  start: string;
  end: string;
}) {
  const currency = await getBookCurrency(orgId);
  const formatCurrency = (value: number) => formatMoney(value, currency);
  const [rows, showAccountCodes] = await Promise.all([
    fetchIncomeStatement(orgId, start, end),
    getUseAccountCodes(orgId),
  ]);
  const revenueRows = rows.filter((r) => r.type === "revenue");
  const expenseRows = rows.filter((r) => r.type === "expense");
  const revenue = revenueRows.reduce((sum, r) => sum + r.amount, 0);
  const expenses = expenseRows.reduce((sum, r) => sum + r.amount, 0);
  const netIncome = revenue - expenses;

  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-5 py-4">
        <h2 className="text-sm font-semibold text-slate-900">
          Income Statement: {start} to {end}
        </h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-5 py-3 font-medium">Account</th>
              <th className="px-5 py-3 font-medium text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={2} className="bg-slate-50 px-5 py-2 text-xs font-semibold uppercase text-slate-500">
                Revenue
              </td>
            </tr>
            {revenueRows.length === 0 ? (
              <tr>
                <td colSpan={2} className="px-5 py-3 text-center text-slate-500">
                  No revenue in this period.
                </td>
              </tr>
            ) : (
              revenueRows.map((r) => (
                <tr key={r.account_id} className="border-b border-slate-100">
                  <td className="px-5 py-3 text-slate-900">
                    <Link
                      href={`/reports/account/${r.account_id}?start=${start}&end=${end}&report=income-statement`}
                      className="underline hover:text-slate-600"
                    >
                      {formatAccountLabel(r, showAccountCodes)}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-right text-slate-900">
                    {formatCurrency(r.amount)}
                  </td>
                </tr>
              ))
            )}
            <tr className="border-t border-slate-200 font-medium">
              <td className="px-5 py-2 text-slate-700">Total Revenue</td>
              <td className="px-5 py-2 text-right text-slate-700">{formatCurrency(revenue)}</td>
            </tr>

            <tr>
              <td colSpan={2} className="bg-slate-50 px-5 py-2 text-xs font-semibold uppercase text-slate-500">
                Expenses
              </td>
            </tr>
            {expenseRows.length === 0 ? (
              <tr>
                <td colSpan={2} className="px-5 py-3 text-center text-slate-500">
                  No expenses in this period.
                </td>
              </tr>
            ) : (
              expenseRows.map((r) => (
                <tr key={r.account_id} className="border-b border-slate-100">
                  <td className="px-5 py-3 text-slate-900">
                    <Link
                      href={`/reports/account/${r.account_id}?start=${start}&end=${end}&report=income-statement`}
                      className="underline hover:text-slate-600"
                    >
                      {formatAccountLabel(r, showAccountCodes)}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-right text-slate-900">
                    {formatCurrency(r.amount)}
                  </td>
                </tr>
              ))
            )}
            <tr className="border-t border-slate-200 font-medium">
              <td className="px-5 py-2 text-slate-700">Total Expenses</td>
              <td className="px-5 py-2 text-right text-slate-700">{formatCurrency(expenses)}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-300 font-semibold">
              <td className="px-5 py-3">Net Income</td>
              <td className="px-5 py-3 text-right">{formatCurrency(netIncome)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
