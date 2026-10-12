import Link from "next/link";
import { fetchBalanceSheet, type BalanceSheetRow } from "@/lib/reports";
import { formatAccountLabel } from "@/lib/accounts/format";
import { getUseAccountCodes } from "@/lib/org/current";

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

// The synthetic Retained Earnings row (account_id null) has no real account
// behind it, so it isn't a drill-down link — just plain text.
function AccountCell({
  row,
  asOf,
  showAccountCodes,
}: {
  row: BalanceSheetRow;
  asOf: string;
  showAccountCodes: boolean;
}) {
  const label = formatAccountLabel(row, showAccountCodes);
  if (!row.account_id) return <>{label}</>;

  return (
    <Link
      href={`/reports/account/${row.account_id}?end=${asOf}&asOf=${asOf}&report=balance-sheet`}
      className="underline hover:text-slate-600"
    >
      {label}
    </Link>
  );
}

export async function BalanceSheetReport({ orgId, asOf }: { orgId: string; asOf: string }) {
  const [rows, showAccountCodes] = await Promise.all([
    fetchBalanceSheet(orgId, asOf),
    getUseAccountCodes(orgId),
  ]);
  const assets = rows.filter((r) => r.type === "asset");
  const liabilities = rows.filter((r) => r.type === "liability");
  const equity = rows.filter((r) => r.type === "equity");
  const totalAssets = assets.reduce((sum, r) => sum + r.balance, 0);
  const totalLiabilities = liabilities.reduce((sum, r) => sum + r.balance, 0);
  const totalEquity = equity.reduce((sum, r) => sum + r.balance, 0);

  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-5 py-4">
        <h2 className="text-sm font-semibold text-slate-900">Balance Sheet as of {asOf}</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-5 py-3 font-medium">Account</th>
              <th className="px-5 py-3 font-medium text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={2} className="bg-slate-50 px-5 py-2 text-xs font-semibold uppercase text-slate-500">
                Assets
              </td>
            </tr>
            {assets.map((r) => (
              <tr key={r.account_id ?? r.name} className="border-b border-slate-100">
                <td className="px-5 py-3 text-slate-900">
                  <AccountCell row={r} asOf={asOf} showAccountCodes={showAccountCodes} />
                </td>
                <td className="px-5 py-3 text-right text-slate-900">
                  {formatCurrency(r.balance)}
                </td>
              </tr>
            ))}
            <tr className="border-t border-slate-200 font-medium">
              <td className="px-5 py-2 text-slate-700">Total Assets</td>
              <td className="px-5 py-2 text-right text-slate-700">
                {formatCurrency(totalAssets)}
              </td>
            </tr>

            <tr>
              <td colSpan={2} className="bg-slate-50 px-5 py-2 text-xs font-semibold uppercase text-slate-500">
                Liabilities
              </td>
            </tr>
            {liabilities.length === 0 ? (
              <tr>
                <td colSpan={2} className="px-5 py-3 text-center text-slate-500">
                  No liabilities.
                </td>
              </tr>
            ) : (
              liabilities.map((r) => (
                <tr key={r.account_id ?? r.name} className="border-b border-slate-100">
                  <td className="px-5 py-3 text-slate-900">
                    <AccountCell row={r} asOf={asOf} showAccountCodes={showAccountCodes} />
                  </td>
                  <td className="px-5 py-3 text-right text-slate-900">
                    {formatCurrency(r.balance)}
                  </td>
                </tr>
              ))
            )}
            <tr className="border-t border-slate-200 font-medium">
              <td className="px-5 py-2 text-slate-700">Total Liabilities</td>
              <td className="px-5 py-2 text-right text-slate-700">
                {formatCurrency(totalLiabilities)}
              </td>
            </tr>

            <tr>
              <td colSpan={2} className="bg-slate-50 px-5 py-2 text-xs font-semibold uppercase text-slate-500">
                Equity
              </td>
            </tr>
            {equity.map((r) => (
              <tr key={r.account_id ?? r.name} className="border-b border-slate-100">
                <td className="px-5 py-3 text-slate-900">
                  <AccountCell row={r} asOf={asOf} showAccountCodes={showAccountCodes} />
                </td>
                <td className="px-5 py-3 text-right text-slate-900">
                  {formatCurrency(r.balance)}
                </td>
              </tr>
            ))}
            <tr className="border-t border-slate-200 font-medium">
              <td className="px-5 py-2 text-slate-700">Total Equity</td>
              <td className="px-5 py-2 text-right text-slate-700">
                {formatCurrency(totalEquity)}
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-300 font-semibold">
              <td className="px-5 py-3">Total Liabilities + Equity</td>
              <td className="px-5 py-3 text-right">
                {formatCurrency(totalLiabilities + totalEquity)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
