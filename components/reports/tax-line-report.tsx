import Link from "next/link";
import { fetchTaxLineReport, type TaxLineReportRow } from "@/lib/reports";
import { FORM_NAMES } from "@/lib/tax/forms";
import { formatMoney } from "@/lib/money";
import { getBookCurrency } from "@/lib/org/book-currency";

function accountsHref(row: TaxLineReportRow, start: string, end: string): string {
  const params = new URLSearchParams({ start, end, type: row.account_type });
  if (row.tax_line_id) {
    params.set("taxLineId", row.tax_line_id);
    if (row.property_id) params.set("propertyId", row.property_id);
  } else {
    params.set("unassigned", "true");
  }
  return `/reports/tax-line/accounts?${params.toString()}`;
}

// A line's name, with its form when the report spans several and its
// property when it's kept per rental.
function lineName(r: TaxLineReportRow, forms: number): string {
  if (!r.code) return r.label;
  const form = forms > 1 && r.form ? `${FORM_NAMES[r.form] ?? r.form} ` : "";
  const property = r.property_name ? ` (${r.property_name})` : "";
  return `${form}${r.code} — ${r.label}${property}`;
}

export async function TaxLineReport({
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
  const rows = await fetchTaxLineReport(orgId, start, end);
  const forms = new Set(rows.map((r) => r.form).filter(Boolean)).size;
  const income = rows.filter((r) => r.account_type === "revenue");
  const expenses = rows.filter((r) => r.account_type === "expense");
  const totalIncome = income.reduce((sum, r) => sum + r.amount, 0);
  const totalExpenses = expenses.reduce((sum, r) => sum + r.amount, 0);

  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-5 py-4">
        <h2 className="text-sm font-semibold text-slate-900">
          Tax Line Report: {start} to {end}
        </h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-5 py-3 font-medium">Tax Line</th>
              <th className="px-5 py-3 font-medium text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={2} className="bg-slate-50 px-5 py-2 text-xs font-semibold uppercase text-slate-500">
                Income
              </td>
            </tr>
            {income.length === 0 ? (
              <tr>
                <td colSpan={2} className="px-5 py-3 text-center text-slate-500">
                  No tagged or untagged income in this period.
                </td>
              </tr>
            ) : (
              income.map((r) => (
                <tr key={`${r.tax_line_id ?? "unassigned-revenue"}-${r.property_id ?? ""}`} className="border-b border-slate-100">
                  <td className="px-5 py-3 text-slate-900">
                    <Link href={accountsHref(r, start, end)} className="underline hover:text-slate-600">
                      {lineName(r, forms)}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-right text-slate-900">{formatCurrency(r.amount)}</td>
                </tr>
              ))
            )}
            <tr className="border-t border-slate-200 font-medium">
              <td className="px-5 py-2 text-slate-700">Total Income</td>
              <td className="px-5 py-2 text-right text-slate-700">{formatCurrency(totalIncome)}</td>
            </tr>

            <tr>
              <td colSpan={2} className="bg-slate-50 px-5 py-2 text-xs font-semibold uppercase text-slate-500">
                Expenses
              </td>
            </tr>
            {expenses.length === 0 ? (
              <tr>
                <td colSpan={2} className="px-5 py-3 text-center text-slate-500">
                  No tagged or untagged expenses in this period.
                </td>
              </tr>
            ) : (
              expenses.map((r) => (
                <tr key={`${r.tax_line_id ?? "unassigned-expense"}-${r.property_id ?? ""}`} className="border-b border-slate-100">
                  <td className="px-5 py-3 text-slate-900">
                    <Link href={accountsHref(r, start, end)} className="underline hover:text-slate-600">
                      {lineName(r, forms)}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-right text-slate-900">{formatCurrency(r.amount)}</td>
                </tr>
              ))
            )}
            <tr className="border-t border-slate-200 font-medium">
              <td className="px-5 py-2 text-slate-700">Total Expenses</td>
              <td className="px-5 py-2 text-right text-slate-700">{formatCurrency(totalExpenses)}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-300 font-semibold">
              <td className="px-5 py-3">Net</td>
              <td className="px-5 py-3 text-right">{formatCurrency(totalIncome - totalExpenses)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
