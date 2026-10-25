import Link from "next/link";
import { fetch1099, nec1099Threshold } from "@/lib/reports/form-1099";
import { formatMoney } from "@/lib/money";
import { getBookCurrency } from "@/lib/org/book-currency";

export async function Form1099Report({ orgId, year }: { orgId: string; year: number }) {
  const currency = await getBookCurrency(orgId);
  const formatCurrency = (value: number) => formatMoney(value, currency);
  const rows = await fetch1099(orgId, year);
  const threshold = nec1099Threshold(year);
  const due = rows.filter((r) => r.meetsThreshold);

  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-5 py-4">
        <h2 className="text-sm font-semibold text-slate-900">1099-NEC: payments in {year}</h2>
        <p className="mt-1 text-xs text-slate-500">
          Vendors marked &ldquo;Gets a 1099-NEC&rdquo;, by what was paid against their bills. A 1099-NEC is due for each
          paid {formatCurrency(threshold)} or more ({due.length} this year). Card payments are left out: the card company
          reports those on a 1099-K. Payments without a bill aren&rsquo;t counted.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-5 py-3 font-medium">Vendor</th>
              <th className="px-5 py-3 font-medium">Address</th>
              <th className="px-5 py-3 text-right font-medium">Paid by card (left out)</th>
              <th className="px-5 py-3 text-right font-medium">Box 1: nonemployee compensation</th>
              <th className="px-5 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-6 text-center text-slate-500">
                  No vendors are marked for a 1099-NEC. Edit a vendor to mark one.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.vendorId} className="border-b border-slate-100 last:border-0">
                  <td className="px-5 py-3 text-slate-900">
                    <Link href={`/vendors/${r.vendorId}`} className="hover:underline">
                      {r.name}
                    </Link>
                  </td>
                  <td className="whitespace-pre-line px-5 py-3 text-slate-600">{r.address ?? "—"}</td>
                  <td className="px-5 py-3 text-right text-slate-500">{r.byCard ? formatCurrency(r.byCard) : ""}</td>
                  <td className="px-5 py-3 text-right font-medium text-slate-900">{formatCurrency(r.paid)}</td>
                  <td className="px-5 py-3 text-xs">
                    {r.meetsThreshold ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800">1099 due</span>
                    ) : (
                      <span className="text-slate-400">under {formatCurrency(threshold)}</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
