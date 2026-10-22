import Link from "next/link";
import { AGING_BUCKETS, fetchApAging } from "@/lib/reports/aging";
import { formatMoney } from "@/lib/money";
import { getBookCurrency } from "@/lib/org/book-currency";

const BUCKET_LABELS: Record<string, string> = {
  current: "Current",
  "1-30": "1–30 days",
  "31-60": "31–60 days",
  "61-90": "61–90 days",
  "90+": "90+ days",
};

export async function ApAgingReport({ orgId, asOf }: { orgId: string; asOf: string }) {
  const currency = await getBookCurrency(orgId);
  const formatCurrency = (value: number) => formatMoney(value, currency);
  const rows = await fetchApAging(orgId, asOf);
  const totalDue = rows.reduce((sum, r) => sum + r.remaining, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900">
            Accounts Payable Aging as of {asOf}
          </h2>
        </div>
        <div className="grid grid-cols-2 gap-px bg-slate-100 sm:grid-cols-5">
          {AGING_BUCKETS.map((bucket) => (
            <div key={bucket} className="bg-white px-5 py-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">
                {BUCKET_LABELS[bucket]}
              </p>
              <p className="mt-1 text-lg font-semibold text-slate-900">
                {formatCurrency(rows.filter((r) => r.bucket === bucket).reduce((s, r) => s + r.remaining, 0))}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">Bill</th>
                <th className="px-5 py-3 font-medium">Vendor</th>
                <th className="px-5 py-3 font-medium">Due Date</th>
                <th className="px-5 py-3 font-medium">Days Overdue</th>
                <th className="px-5 py-3 font-medium">Bucket</th>
                <th className="px-5 py-3 text-right font-medium">Amount Due</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-6 text-center text-slate-500">
                    No outstanding bills.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-5 py-3 text-slate-900">
                      {row.partyId ? (
                        <Link href={`/vendors/${row.partyId}`} className="hover:underline">
                          {row.number}
                        </Link>
                      ) : (
                        row.number
                      )}
                    </td>
                    <td className="px-5 py-3 text-slate-600">
                      {row.partyId ? (
                        <Link href={`/vendors/${row.partyId}`} className="hover:underline">
                          {row.partyName}
                        </Link>
                      ) : (
                        row.partyName
                      )}
                    </td>
                    <td className="px-5 py-3 text-slate-600">{row.dueDate}</td>
                    <td className="px-5 py-3 text-slate-600">{Math.max(row.daysOverdue, 0)}</td>
                    <td className="px-5 py-3 text-slate-600">{BUCKET_LABELS[row.bucket]}</td>
                    <td className="px-5 py-3 text-right text-slate-900">
                      {formatCurrency(row.remaining)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-slate-300 font-semibold">
                  <td className="px-5 py-3" colSpan={5}>
                    Total
                  </td>
                  <td className="px-5 py-3 text-right">{formatCurrency(totalDue)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
