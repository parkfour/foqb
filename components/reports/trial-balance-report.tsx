import Link from "next/link";
import { fetchTrialBalance } from "@/lib/reports";
import { formatAccountLabel } from "@/lib/accounts/format";
import { getUseAccountCodes } from "@/lib/org/current";

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

export async function TrialBalanceReport({ orgId, asOf }: { orgId: string; asOf: string }) {
  const [rows, showAccountCodes] = await Promise.all([
    fetchTrialBalance(orgId, asOf),
    getUseAccountCodes(orgId),
  ]);
  const totalDebit = rows.reduce((sum, r) => sum + r.total_debit, 0);
  const totalCredit = rows.reduce((sum, r) => sum + r.total_credit, 0);

  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-5 py-4">
        <h2 className="text-sm font-semibold text-slate-900">Trial Balance as of {asOf}</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-5 py-3 font-medium">Account</th>
              <th className="px-5 py-3 font-medium">Type</th>
              <th className="px-5 py-3 font-medium text-right">Debit</th>
              <th className="px-5 py-3 font-medium text-right">Credit</th>
              <th className="px-5 py-3 font-medium text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-6 text-center text-slate-500">
                  No accounts yet.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.account_id} className="border-b border-slate-100 last:border-0">
                  <td className="px-5 py-3 text-slate-900">
                    <Link
                      href={`/reports/account/${r.account_id}?end=${asOf}&asOf=${asOf}&report=trial-balance`}
                      className="underline hover:text-slate-600"
                    >
                      {formatAccountLabel(r, showAccountCodes)}
                    </Link>
                  </td>
                  <td className="px-5 py-3 capitalize text-slate-600">{r.type}</td>
                  <td className="px-5 py-3 text-right text-slate-900">
                    {formatCurrency(r.total_debit)}
                  </td>
                  <td className="px-5 py-3 text-right text-slate-900">
                    {formatCurrency(r.total_credit)}
                  </td>
                  <td className="px-5 py-3 text-right text-slate-900">
                    {formatCurrency(r.balance)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-slate-300 font-semibold">
                <td className="px-5 py-3" colSpan={2}>
                  Total
                </td>
                <td className="px-5 py-3 text-right">{formatCurrency(totalDebit)}</td>
                <td className="px-5 py-3 text-right">{formatCurrency(totalCredit)}</td>
                <td className="px-5 py-3 text-right" />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
