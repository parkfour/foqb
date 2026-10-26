import Link from "next/link";
import type { ReactNode } from "react";
import { fetchCashFlowStatement, type CashFlowLine } from "@/lib/reports/cash-flow";
import { formatAccountLabel } from "@/lib/accounts/format";
import { getUseAccountCodes } from "@/lib/org/current";
import { formatMoney } from "@/lib/money";
import { getBookCurrency } from "@/lib/org/book-currency";

const total = (lines: CashFlowLine[]) => lines.reduce((sum, l) => sum + l.amount, 0);

export async function CashFlowStatementReport({ orgId, start, end }: { orgId: string; start: string; end: string }) {
  const currency = await getBookCurrency(orgId);
  const formatCurrency = (value: number) => formatMoney(value, currency);
  const [s, showAccountCodes] = await Promise.all([
    fetchCashFlowStatement(orgId, start, end),
    getUseAccountCodes(orgId),
  ]);
  const operating = s.netIncome + total(s.operating);
  const investing = total(s.investing);
  const financing = total(s.financing);

  const lineRows = (lines: CashFlowLine[], empty: string) =>
    lines.length === 0 ? (
      <tr>
        <td colSpan={2} className="px-5 py-3 text-center text-slate-500">
          {empty}
        </td>
      </tr>
    ) : (
      lines.map((l) => (
        <tr key={l.account_id} className="border-b border-slate-100">
          <td className="px-5 py-3 text-slate-900">
            <Link
              href={`/reports/account/${l.account_id}?start=${start}&end=${end}&report=cash-flow-statement`}
              className="underline hover:text-slate-600"
            >
              {formatAccountLabel(l, showAccountCodes)}
            </Link>
          </td>
          <td className="px-5 py-3 text-right text-slate-900">{formatCurrency(l.amount)}</td>
        </tr>
      ))
    );

  const section = (title: string, body: ReactNode, totalLabel: string, amount: number) => (
    <>
      <tr>
        <td colSpan={2} className="bg-slate-50 px-5 py-2 text-xs font-semibold uppercase text-slate-500">
          {title}
        </td>
      </tr>
      {body}
      <tr className="border-t border-slate-200 font-medium">
        <td className="px-5 py-2 text-slate-700">{totalLabel}</td>
        <td className="px-5 py-2 text-right text-slate-700">{formatCurrency(amount)}</td>
      </tr>
    </>
  );

  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-5 py-4">
        <h2 className="text-sm font-semibold text-slate-900">
          Statement of Cash Flows: {start} to {end}
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Indirect method. Sections come from account names: loans, mortgages, notes payable and equity are
          financing; equipment, vehicles, property and fixed assets are investing; bank accounts are cash.
        </p>
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
            {section(
              "Operating activities",
              <>
                <tr className="border-b border-slate-100">
                  <td className="px-5 py-3 text-slate-900">
                    <Link
                      href={`/reports?report=income-statement&start=${start}&end=${end}`}
                      className="underline hover:text-slate-600"
                    >
                      Net income
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-right text-slate-900">{formatCurrency(s.netIncome)}</td>
                </tr>
                {s.operating.length > 0 && lineRows(s.operating, "")}
              </>,
              "Net cash from operating activities",
              operating,
            )}
            {section(
              "Investing activities",
              lineRows(s.investing, "No investing activity in this period."),
              "Net cash from investing activities",
              investing,
            )}
            {section(
              "Financing activities",
              lineRows(s.financing, "No financing activity in this period."),
              "Net cash from financing activities",
              financing,
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-300 font-semibold">
              <td className="px-5 py-3">Net change in cash</td>
              <td className="px-5 py-3 text-right">{formatCurrency(operating + investing + financing)}</td>
            </tr>
            <tr className="text-slate-700">
              <td className="px-5 py-2">Cash at the start ({start})</td>
              <td className="px-5 py-2 text-right">{formatCurrency(s.cashAtStart)}</td>
            </tr>
            <tr className="font-semibold">
              <td className="px-5 py-2">Cash at the end ({end})</td>
              <td className="px-5 py-2 text-right">{formatCurrency(s.cashAtEnd)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {s.difference !== 0 && (
        <p className="border-t border-slate-200 px-5 py-3 text-xs text-rose-600">
          {formatCurrency(s.difference)} of the change in cash isn&apos;t explained by the sections above.
        </p>
      )}
    </div>
  );
}
