import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId, getUseAccountCodes } from "@/lib/org/current";
import { formatAccountLabel } from "@/lib/accounts/format";
import { fetchAccountLedger, type AccountLedgerRow } from "@/lib/reports";
import { TimezoneChangeNotice } from "@/components/ui/timezone-change-notice";
import { bookToday } from "@/lib/org/book-clock";

interface AccountRow {
  id: string;
  account_number: string;
  name: string;
  type: "asset" | "liability" | "equity" | "revenue" | "expense";
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function withRunningBalance(rows: AccountLedgerRow[], isDebitNormal: boolean) {
  let balance = 0;
  return rows.map((r) => {
    balance += isDebitNormal ? r.debit - r.credit : r.credit - r.debit;
    return { ...r, runningBalance: balance };
  });
}

interface PageProps {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{ start?: string; end?: string; report?: string; asOf?: string; from?: string; month?: string }>;
}

export default async function AccountLedgerPage({ params, searchParams }: PageProps) {
  const { accountId } = await params;
  const sp = await searchParams;
  const orgId = await getCurrentOrgId();

  if (!orgId) {
    redirect("/");
  }

  const end = sp.end ?? (await bookToday(orgId));
  const start = sp.start || null;

  const supabase = await createClient();
  const [{ data: accountData }, rows, showAccountCodes] = await Promise.all([
    supabase
      .from("accounts")
      .select("id, account_number, name, type")
      .eq("id", accountId)
      .eq("organization_id", orgId)
      .maybeSingle(),
    fetchAccountLedger(orgId, accountId, start, end),
    getUseAccountCodes(orgId),
  ]);

  const account = accountData as AccountRow | null;
  if (!account) {
    notFound();
  }

  // Same debit/credit-normal convention as get_trial_balance/get_balance_sheet.
  const isDebitNormal = account.type === "asset" || account.type === "expense";
  const rowsWithBalance = withRunningBalance(rows, isDebitNormal);

  const backParams = new URLSearchParams();
  if (sp.report) backParams.set("report", sp.report);
  if (sp.asOf) backParams.set("asOf", sp.asOf);
  if (sp.start) backParams.set("start", sp.start);
  if (sp.end) backParams.set("end", sp.end);
  // Opened from a household page (Chart of Accounts, Net Worth, Cash Flow,
  // Budget) or from a report.
  const back =
    sp.from === "accounts"
      ? { href: "/accounts", label: "← Chart of Accounts" }
      : sp.from === "networth"
        ? { href: "/", label: "← Net Worth" }
        : sp.from === "cashflow"
          ? { href: "/cash-flow", label: "← Cash Flow" }
          : sp.from === "budget"
            ? { href: `/budget${/^\d{4}-\d{2}$/.test(sp.month ?? "") ? `?month=${sp.month}` : ""}`, label: "← Budget" }
            : { href: `/reports${backParams.toString() ? `?${backParams.toString()}` : ""}`, label: "← Back to report" };

  return (
    <div className="flex flex-col gap-6">
      <TimezoneChangeNotice from={start ?? "0001-01-01"} to={end} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          title={formatAccountLabel(account, showAccountCodes)}
          description={
            start ? `Transactions from ${start} through ${end}` : `Transactions through ${end}`
          }
        />
        <Link
          href={back.href}
          className="text-sm font-medium text-slate-600 underline hover:text-slate-900"
        >
          {back.label}
        </Link>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
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
            <tbody>
              {rowsWithBalance.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-6 text-center text-slate-500">
                    No transactions in this period.
                  </td>
                </tr>
              ) : (
                rowsWithBalance.map((r, i) => (
                  <tr key={`${r.entry_id}-${i}`} className="border-b border-slate-100 last:border-0">
                    <td className="px-5 py-3 text-slate-600">{r.entry_date}</td>
                    <td className="px-5 py-3 text-slate-900">{r.memo ?? r.description ?? "—"}</td>
                    <td className="px-5 py-3 text-right text-slate-900">
                      {r.debit ? formatCurrency(r.debit) : ""}
                    </td>
                    <td className="px-5 py-3 text-right text-slate-900">
                      {r.credit ? formatCurrency(r.credit) : ""}
                    </td>
                    <td className="px-5 py-3 text-right font-medium text-slate-900">
                      {formatCurrency(r.runningBalance)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
