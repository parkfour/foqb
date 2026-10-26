import Link from "next/link";
import { fetchIncomeStatementByClass } from "@/lib/reports/by-class";
import { formatAccountLabel } from "@/lib/accounts/format";
import { getUseAccountCodes } from "@/lib/org/current";
import { formatMoney } from "@/lib/money";
import { getBookCurrency } from "@/lib/org/book-currency";

export async function IncomeStatementByClassReport({ orgId, start, end }: { orgId: string; start: string; end: string }) {
  const currency = await getBookCurrency(orgId);
  const formatCurrency = (value: number) => formatMoney(value, currency);
  const [table, showAccountCodes] = await Promise.all([fetchIncomeStatementByClass(orgId, start, end), getUseAccountCodes(orgId)]);
  const { columns, rows } = table;
  const sum = (type: "revenue" | "expense", key: string | null) =>
    rows
      .filter((r) => r.type === type)
      .reduce((s, r) => s + (key === null ? Object.values(r.amounts).reduce((a, b) => a + b, 0) : (r.amounts[key] ?? 0)), 0);
  const keys = [...columns.map((c) => c.key as string | null), null];
  const cell = "px-4 py-2 text-right whitespace-nowrap";

  const section = (type: "revenue" | "expense", title: string) => (
    <>
      <tr>
        <td colSpan={keys.length + 1} className="bg-slate-50 px-4 py-2 text-xs font-semibold uppercase text-slate-500">
          {title}
        </td>
      </tr>
      {rows
        .filter((r) => r.type === type)
        .map((r) => (
          <tr key={r.account_id} className="border-b border-slate-100">
            <td className="px-4 py-2 text-slate-900">
              <Link href={`/reports/account/${r.account_id}?start=${start}&end=${end}&report=income-statement-by-class`} className="underline hover:text-slate-600">
                {formatAccountLabel(r, showAccountCodes)}
              </Link>
            </td>
            {keys.map((k) => (
              <td key={k ?? "total"} className={`${cell} ${k === null ? "font-medium" : ""}`}>
                {formatCurrency(k === null ? Object.values(r.amounts).reduce((a, b) => a + b, 0) : (r.amounts[k] ?? 0))}
              </td>
            ))}
          </tr>
        ))}
      <tr className="border-t border-slate-200 font-medium">
        <td className="px-4 py-2 text-slate-700">Total {title.toLowerCase()}</td>
        {keys.map((k) => (
          <td key={k ?? "total"} className={cell}>
            {formatCurrency(sum(type, k))}
          </td>
        ))}
      </tr>
    </>
  );

  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-5 py-4">
        <h2 className="text-sm font-semibold text-slate-900">
          Profit &amp; Loss by Class: {start} to {end}
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          <Link href="/classes" className="underline">
            Manage classes
          </Link>
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="px-5 py-6 text-center text-sm text-slate-500">No income or expenses in this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3 font-medium">Account</th>
                {columns.map((c) => (
                  <th key={c.key} className="px-4 py-3 text-right font-medium">
                    {c.name}
                  </th>
                ))}
                <th className="px-4 py-3 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {section("revenue", "Revenue")}
              {section("expense", "Expenses")}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-300 font-semibold">
                <td className="px-4 py-3">Net income</td>
                {keys.map((k) => (
                  <td key={k ?? "total"} className={cell}>
                    {formatCurrency(sum("revenue", k) - sum("expense", k))}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
