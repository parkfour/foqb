import Link from "next/link";
import { fetchSalesTax } from "@/lib/reports/sales-tax";
import { formatMoney } from "@/lib/money";
import { getBookCurrency } from "@/lib/org/book-currency";

export async function SalesTaxReport({ orgId, start, end }: { orgId: string; start: string; end: string }) {
  const currency = await getBookCurrency(orgId);
  const formatCurrency = (value: number) => formatMoney(value, currency);
  const { rows, accounts } = await fetchSalesTax(orgId, start, end);
  const th = "px-5 py-3 font-medium";

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900">
            Sales tax collected, {start} to {end}
          </h2>
          <p className="mt-1 text-xs text-slate-500">By invoice date. Taxable sales are the invoices&rsquo; amounts before tax.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className={th}>Rate</th>
                <th className={`${th} text-right`}>Taxable sales</th>
                <th className={`${th} text-right`}>Tax collected</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-5 py-6 text-center text-slate-500">
                    No sales tax on invoices in this period.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.key} className="border-b border-slate-100 last:border-0">
                    <td className="px-5 py-3 text-slate-900">{r.name}</td>
                    <td className="px-5 py-3 text-right text-slate-600">{formatCurrency(r.taxableSales)}</td>
                    <td className="px-5 py-3 text-right font-medium text-slate-900">{formatCurrency(r.collected)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {accounts.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-sm font-semibold text-slate-900">Owed to each agency</h2>
            <p className="mt-1 text-xs text-slate-500">
              Paid: payments booked to the account in the period. Owed: its balance on {end}.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className={th}>Account</th>
                  <th className={`${th} text-right`}>Paid</th>
                  <th className={`${th} text-right`}>Owed</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.accountId} className="border-b border-slate-100 last:border-0">
                    <td className="px-5 py-3 text-slate-900">
                      <Link href={`/reports/account/${a.accountId}?start=${start}&end=${end}`} className="underline hover:text-slate-600">
                        {a.name}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-right text-slate-600">{formatCurrency(a.paid)}</td>
                    <td className="px-5 py-3 text-right font-medium text-slate-900">{formatCurrency(a.owed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
