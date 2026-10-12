import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { ReadOnlyNotice } from "@/components/ui/read-only-notice";
import { createClient } from "@/lib/supabase/server";
import { canWrite, getCurrentOrgId, getCurrentUserRole, getUseAccountCodes } from "@/lib/org/current";
import { formatAccountLabel } from "@/lib/accounts/format";
import { startReconciliation, cancelReconciliation } from "./actions";

interface AccountOption {
  id: string;
  account_number: string;
  name: string;
}

interface ReconciliationRow {
  id: string;
  statement_date: string;
  statement_ending_balance: number;
  status: "in_progress" | "completed";
  completed_at: string | null;
  accounts: { account_number: string; name: string } | null;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

export default async function ReconcilePage() {
  const orgId = await getCurrentOrgId();

  if (!orgId) {
    return (
      <div>
        <PageHeader title="Reconcile" description="Match a bank statement against your books." />
        <p className="text-sm text-slate-500">Create an organization first.</p>
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data: accountData }, { data: reconciliationData }, role, showAccountCodes] = await Promise.all([
    supabase
      .from("accounts")
      .select("id, account_number, name")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .in("type", ["asset", "liability"])
      .order("account_number"),
    supabase
      .from("bank_reconciliations")
      .select("id, statement_date, statement_ending_balance, status, completed_at, accounts(account_number, name)")
      .eq("organization_id", orgId)
      .order("statement_date", { ascending: false }),
    getCurrentUserRole(orgId),
    getUseAccountCodes(orgId),
  ]);

  const accounts = (accountData as AccountOption[] | null) ?? [];
  const reconciliations = (reconciliationData as unknown as ReconciliationRow[] | null) ?? [];
  const inProgress = reconciliations.filter((r) => r.status === "in_progress");
  const completed = reconciliations.filter((r) => r.status === "completed");
  const userCanWrite = canWrite(role);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Reconcile" description="Match a bank statement against your books." />

      {inProgress.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">In Progress</h2>
          <div className="flex flex-col gap-2">
            {inProgress.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between rounded-md border border-slate-100 px-3 py-2"
              >
                <div>
                  <p className="text-sm text-slate-900">
                    {r.accounts ? formatAccountLabel(r.accounts, showAccountCodes) : "—"}
                  </p>
                  <p className="text-xs text-slate-500">
                    Statement date {r.statement_date} · Ending balance{" "}
                    {formatCurrency(Number(r.statement_ending_balance))}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Link
                    href={`/reconcile/${r.id}`}
                    className="text-sm font-medium text-slate-900 underline"
                  >
                    Continue
                  </Link>
                  {userCanWrite && (
                    <form action={cancelReconciliation}>
                      <input type="hidden" name="id" value={r.id} />
                      <button type="submit" className="text-sm text-slate-400 hover:text-red-600">
                        Cancel
                      </button>
                    </form>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Start a Reconciliation</h2>
        {!userCanWrite ? (
          <ReadOnlyNotice />
        ) : (
          <form action={startReconciliation} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="organizationId" value={orgId} />
            <div className="flex flex-col gap-1">
              <label htmlFor="accountId" className="text-xs font-medium text-slate-600">
                Account
              </label>
              <select
                id="accountId"
                name="accountId"
                required
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {formatAccountLabel(account, showAccountCodes)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="statementDate" className="text-xs font-medium text-slate-600">
                Statement Date
              </label>
              <input
                type="date"
                id="statementDate"
                name="statementDate"
                required
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="statementEndingBalance" className="text-xs font-medium text-slate-600">
                Statement Ending Balance
              </label>
              <input
                type="number"
                step="0.01"
                id="statementEndingBalance"
                name="statementEndingBalance"
                required
                className="w-40 rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <button
              type="submit"
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Start
            </button>
          </form>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900">History</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">Account</th>
                <th className="px-5 py-3 font-medium">Statement Date</th>
                <th className="px-5 py-3 font-medium">Ending Balance</th>
                <th className="px-5 py-3 font-medium">Completed</th>
              </tr>
            </thead>
            <tbody>
              {completed.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-5 py-6 text-center text-slate-500">
                    No completed reconciliations yet.
                  </td>
                </tr>
              ) : (
                completed.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-5 py-3 text-slate-900">
                      {r.accounts ? formatAccountLabel(r.accounts, showAccountCodes) : "—"}
                    </td>
                    <td className="px-5 py-3 text-slate-600">{r.statement_date}</td>
                    <td className="px-5 py-3 text-slate-600">
                      {formatCurrency(Number(r.statement_ending_balance))}
                    </td>
                    <td className="px-5 py-3 text-slate-600">
                      {r.completed_at ? new Date(r.completed_at).toLocaleDateString() : "—"}
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
