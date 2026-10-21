import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { getCurrentOrgId, getUseAccountCodes } from "@/lib/org/current";
import { formatAccountLabel } from "@/lib/accounts/format";
import { fetchTaxLineAccounts } from "@/lib/reports";
import { TimezoneChangeNotice } from "@/components/ui/timezone-change-notice";
import { bookToday } from "@/lib/org/book-clock";

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

interface PageProps {
  searchParams: Promise<{
    taxLineId?: string;
    propertyId?: string;
    unassigned?: string;
    type?: string;
    start?: string;
    end?: string;
  }>;
}

export default async function TaxLineAccountsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const orgId = await getCurrentOrgId();

  if (!orgId) {
    redirect("/");
  }

  const type = sp.type === "revenue" ? "revenue" : "expense";
  const taxLineId = sp.unassigned === "true" ? null : (sp.taxLineId ?? null);
  const start = sp.start ?? (await bookToday(orgId));
  const end = sp.end ?? start;

  const [rows, showAccountCodes] = await Promise.all([
    fetchTaxLineAccounts(orgId, taxLineId, type, start, end, sp.propertyId ?? null),
    getUseAccountCodes(orgId),
  ]);

  const total = rows.reduce((sum, r) => sum + r.amount, 0);

  const reportBackParams = new URLSearchParams({ report: "tax-line-items", start, end });

  return (
    <div className="flex flex-col gap-6">
      <TimezoneChangeNotice from={start} to={end} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          title={taxLineId ? "Accounts for this tax line" : "Unassigned accounts"}
          description={`Activity from ${start} to ${end}`}
        />
        <Link
          href={`/reports?${reportBackParams.toString()}`}
          className="text-sm font-medium text-slate-600 underline hover:text-slate-900"
        >
          ← Back to tax line report
        </Link>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">Account</th>
                <th className="px-5 py-3 font-medium text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={2} className="px-5 py-6 text-center text-slate-500">
                    No accounts here for this period.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.account_id} className="border-b border-slate-100 last:border-0">
                    <td className="px-5 py-3 text-slate-900">
                      <Link
                        href={`/reports/account/${r.account_id}?start=${start}&end=${end}&report=tax-line-items`}
                        className="underline hover:text-slate-600"
                      >
                        {formatAccountLabel(r, showAccountCodes)}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-right text-slate-900">{formatCurrency(r.amount)}</td>
                  </tr>
                ))
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-slate-300 font-semibold">
                  <td className="px-5 py-3">Total</td>
                  <td className="px-5 py-3 text-right">{formatCurrency(total)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
