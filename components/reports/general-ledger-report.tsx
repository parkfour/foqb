import Link from "next/link";
import { fetchGeneralLedger } from "@/lib/reports";
import { formatAccountLabel } from "@/lib/accounts/format";
import { getUseAccountCodes } from "@/lib/org/current";
import { formatMoney } from "@/lib/money";
import { getBookCurrency } from "@/lib/org/book-currency";

export async function GeneralLedgerReport({ orgId, start, end }: { orgId: string; start: string; end: string }) {
  const currency = await getBookCurrency(orgId);
  const formatCurrency = (value: number) => formatMoney(value, currency);
  const [accounts, showAccountCodes] = await Promise.all([
    fetchGeneralLedger(orgId, start, end),
    getUseAccountCodes(orgId),
  ]);

  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-5 py-4">
        <h2 className="text-sm font-semibold text-slate-900">
          General Ledger: {start} to {end}
        </h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-5 py-3 font-medium">Date</th>
              <th className="px-5 py-3 font-medium">Memo</th>
              <th className="px-5 py-3 font-medium text-right">Debit</th>
              <th className="px-5 py-3 font-medium text-right">Credit</th>
              <th className="px-5 py-3 font-medium text-right">Balance</th>
            </tr>
          </thead>
          {accounts.length === 0 ? (
            <tbody>
              <tr>
                <td colSpan={5} className="px-5 py-6 text-center text-slate-500">
                  No transactions in this period.
                </td>
              </tr>
            </tbody>
          ) : (
            accounts.map(({ account, opening, lines, closing }) => (
              <tbody key={account.account_id}>
                <tr>
                  <td colSpan={5} className="bg-slate-50 px-5 py-2 text-xs font-semibold text-slate-700">
                    <Link
                      href={`/reports/account/${account.account_id}?start=${start}&end=${end}&report=general-ledger`}
                      className="underline hover:text-slate-600"
                    >
                      {formatAccountLabel(account, showAccountCodes)}
                    </Link>
                  </td>
                </tr>
                <tr className="border-b border-slate-100 text-slate-500">
                  <td className="px-5 py-2" colSpan={4}>
                    Opening balance
                  </td>
                  <td className="px-5 py-2 text-right">{formatCurrency(opening)}</td>
                </tr>
                {lines.map((l, i) => (
                  <tr key={`${l.entry_id}-${i}`} className="border-b border-slate-100">
                    <td className="px-5 py-2 text-slate-600">{l.entry_date}</td>
                    <td className="px-5 py-2 text-slate-900">
                      <Link href={`/journal/${l.entry_id}`} className="hover:underline">
                        {l.description ?? l.memo ?? "—"}
                      </Link>
                    </td>
                    <td className="px-5 py-2 text-right text-slate-900">{l.debit ? formatCurrency(l.debit) : ""}</td>
                    <td className="px-5 py-2 text-right text-slate-900">{l.credit ? formatCurrency(l.credit) : ""}</td>
                    <td className="px-5 py-2 text-right text-slate-900">{formatCurrency(l.balance)}</td>
                  </tr>
                ))}
                <tr className="border-b border-slate-200 font-medium">
                  <td className="px-5 py-2 text-slate-700" colSpan={4}>
                    Closing balance
                  </td>
                  <td className="px-5 py-2 text-right text-slate-700">{formatCurrency(closing)}</td>
                </tr>
              </tbody>
            ))
          )}
        </table>
      </div>
    </div>
  );
}
