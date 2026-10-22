import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { getCurrentOrgId, getUseAccountCodes } from "@/lib/org/current";
import { formatAccountLabel } from "@/lib/accounts/format";
import { fetchAccountLedger, fetchTaxLineAccounts } from "@/lib/reports";
import { entryHrefs } from "@/lib/reports/entry-links";
import { createClient } from "@/lib/supabase/server";
import { TimezoneChangeNotice } from "@/components/ui/timezone-change-notice";
import { bookToday } from "@/lib/org/book-clock";
import { formatMoney } from "@/lib/money";
import { getBookCurrency } from "@/lib/org/book-currency";

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
  const currency = await getBookCurrency(orgId);
  const formatCurrency = (value: number) => formatMoney(value, currency);

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

  // Each account's transactions in the period, signed the way the tax line
  // adds them up. ponytail: one ledger read per account; fine for the
  // handful of accounts a tax line has.
  const supabase = await createClient();
  const sections = await Promise.all(
    rows.map(async (r) => {
      const [ledger, hrefFor] = await Promise.all([
        fetchAccountLedger(orgId, r.account_id, start, end),
        entryHrefs(supabase, orgId, r.account_id),
      ]);
      return {
        account: r,
        lines: ledger.map((line) => ({
          ...line,
          amount: type === "expense" ? line.debit - line.credit : line.credit - line.debit,
          href: hrefFor(line.entry_id),
        })),
      };
    }),
  );

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

      {sections.map(({ account, lines }) => (
        <section
          key={account.account_id}
          aria-label={formatAccountLabel(account, showAccountCodes)}
          className="rounded-lg border border-slate-200 bg-white shadow-sm"
        >
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
            <h2 className="text-sm font-semibold text-slate-900">{formatAccountLabel(account, showAccountCodes)}</h2>
            <span className="text-sm font-semibold text-slate-900">{formatCurrency(account.amount)}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {lines.map((line, i) => (
                  <tr key={`${line.entry_id}-${i}`} className="border-b border-slate-100 last:border-0">
                    <td className="px-5 py-2 text-slate-600 whitespace-nowrap">{line.entry_date}</td>
                    <td className="px-5 py-2 text-slate-900">
                      <Link href={line.href} className="hover:underline">
                        {line.memo ?? line.description ?? "—"}
                      </Link>
                    </td>
                    <td className="px-5 py-2 text-right text-slate-900">{formatCurrency(line.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
