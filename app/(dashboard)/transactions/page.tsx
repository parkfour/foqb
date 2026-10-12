import { PageHeader } from "@/components/ui/page-header";
import { ReadOnlyNotice } from "@/components/ui/read-only-notice";
import { DownloadButton } from "@/components/ui/download-button";
import { JournalEntryForm } from "@/components/transactions/journal-entry-form";
import { CsvImportForm } from "@/components/csv/import-form";
import { createClient } from "@/lib/supabase/server";
import { canWrite, getCurrentOrgId, getCurrentUserRole, getUseAccountCodes } from "@/lib/org/current";
import { formatAccountLabel } from "@/lib/accounts/format";
import {
  categorizeBankTransaction,
  dismissBankChange,
  ignoreBankTransaction,
  reopenBankTransaction,
  voidJournalEntry,
} from "./actions";

interface AccountOption {
  id: string;
  account_number: string;
  name: string;
}

interface BankTransactionRow {
  id: string;
  date: string;
  name: string | null;
  amount: number;
  status: "unreconciled" | "matched" | "ignored";
  // What the bank now reports for a matched transaction, held for review.
  bank_change: { amount: number; date: string } | null;
  // Why the change can't be applied automatically, or null if it can.
  reopen_blocker: string | null;
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

interface JournalEntryRow {
  id: string;
  entry_date: string;
  memo: string | null;
  status: "draft" | "posted" | "void";
  journal_lines: { debit: number }[];
}

export default async function TransactionsPage() {
  const orgId = await getCurrentOrgId();

  if (!orgId) {
    return (
      <div>
        <PageHeader title="Bank Transactions" description="Bank feed and reconciliation table." />
        <p className="text-sm text-slate-500">Create an organization first.</p>
      </div>
    );
  }

  const supabase = await createClient();

  const [{ data: accountsData }, { data: transactionsData }, { data: journalEntriesData }, role, showAccountCodes] =
    await Promise.all([
      supabase
        .from("accounts")
        .select("id, account_number, name")
        .eq("organization_id", orgId)
        .eq("is_active", true)
        .order("account_number"),
      supabase
        .from("bank_transactions")
        .select("id, date, name, amount, status, bank_change, reopen_blocker")
        .eq("organization_id", orgId)
        .order("date", { ascending: false })
        .limit(50),
      supabase
        .from("journal_entries")
        .select("id, entry_date, memo, status, journal_lines(debit)")
        .eq("organization_id", orgId)
        .in("status", ["posted", "void"])
        .order("entry_date", { ascending: false })
        .limit(20),
      getCurrentUserRole(orgId),
      getUseAccountCodes(orgId),
    ]);

  const accounts = (accountsData as AccountOption[] | null) ?? [];
  const transactions = (transactionsData as BankTransactionRow[] | null) ?? [];
  const journalEntries = (journalEntriesData as JournalEntryRow[] | null) ?? [];
  const userCanWrite = canWrite(role);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader title="Bank Transactions" description="Bank feed and reconciliation table." />
        <div className="flex flex-wrap items-center gap-3">
          <DownloadButton
            href="/api/export/journal-entries"
            label="Export Journal Entries CSV"
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          />
          {userCanWrite && <CsvImportForm action="/api/import/journal-entries" label="Import CSV" />}
        </div>
      </div>

      {userCanWrite ? (
        <JournalEntryForm organizationId={orgId} accounts={accounts} showAccountCodes={showAccountCodes} />
      ) : (
        <ReadOnlyNotice />
      )}

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900">Bank Feed</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium">Description</th>
                <th className="px-5 py-3 font-medium">Amount</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Categorize</th>
              </tr>
            </thead>
            <tbody>
              {transactions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-6 text-center text-slate-500">
                    No bank transactions yet.
                  </td>
                </tr>
              ) : (
                transactions.map((tx) => (
                  <tr key={tx.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-5 py-3 text-slate-600">{tx.date}</td>
                    <td className="px-5 py-3 text-slate-900">
                      {tx.name ?? "—"}
                      {tx.bank_change && (
                        <p className="mt-1 text-xs text-amber-700">
                          Bank changed this: {usd.format(tx.amount)} on {tx.date} →{" "}
                          {usd.format(tx.bank_change.amount)} on {tx.bank_change.date}
                        </p>
                      )}
                    </td>
                    <td className="px-5 py-3 text-slate-900">{usd.format(tx.amount)}</td>
                    <td className="px-5 py-3">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                          tx.status === "matched"
                            ? "bg-emerald-100 text-emerald-800"
                            : tx.status === "ignored"
                              ? "bg-slate-100 text-slate-600"
                              : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {tx.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      {userCanWrite && tx.bank_change && (
                        <div className="flex items-center justify-end gap-2">
                          {tx.reopen_blocker ? (
                            <span className="max-w-xs text-xs text-slate-500">{tx.reopen_blocker}</span>
                          ) : (
                            <form action={reopenBankTransaction}>
                              <input type="hidden" name="id" value={tx.id} />
                              <button
                                type="submit"
                                title="Void the entry and re-categorize with the bank's new amount and date"
                                className="rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white hover:bg-slate-800"
                              >
                                Re-open
                              </button>
                            </form>
                          )}
                          <form action={dismissBankChange}>
                            <input type="hidden" name="id" value={tx.id} />
                            <button type="submit" className="text-sm text-slate-400 hover:text-slate-900">
                              Dismiss
                            </button>
                          </form>
                        </div>
                      )}
                      {userCanWrite && tx.status === "unreconciled" && (
                        <div className="flex items-center justify-end gap-2">
                          <form action={categorizeBankTransaction} className="flex items-center gap-2">
                            <input type="hidden" name="bankTransactionId" value={tx.id} />
                            <select
                              name="targetAccountId"
                              required
                              defaultValue=""
                              className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                            >
                              <option value="" disabled>
                                Categorize as…
                              </option>
                              {accounts.map((account) => (
                                <option key={account.id} value={account.id}>
                                  {formatAccountLabel(account, showAccountCodes)}
                                </option>
                              ))}
                            </select>
                            <button
                              type="submit"
                              className="rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white hover:bg-slate-800"
                            >
                              Post
                            </button>
                          </form>
                          <form action={ignoreBankTransaction}>
                            <input type="hidden" name="id" value={tx.id} />
                            <button
                              type="submit"
                              className="text-sm text-slate-400 hover:text-slate-900"
                            >
                              Ignore
                            </button>
                          </form>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900">Recent Journal Entries</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium">Memo</th>
                <th className="px-5 py-3 font-medium">Amount</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {journalEntries.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-6 text-center text-slate-500">
                    No journal entries yet.
                  </td>
                </tr>
              ) : (
                journalEntries.map((entry) => {
                  const amount = (entry.journal_lines ?? []).reduce(
                    (sum, line) => sum + Number(line.debit),
                    0,
                  );
                  return (
                    <tr key={entry.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-5 py-3 text-slate-600">{entry.entry_date}</td>
                      <td className="px-5 py-3 text-slate-900">{entry.memo ?? "—"}</td>
                      <td className="px-5 py-3 text-slate-900">
                        {new Intl.NumberFormat("en-US", {
                          style: "currency",
                          currency: "USD",
                        }).format(amount)}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                            entry.status === "posted"
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {entry.status}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        {userCanWrite && entry.status === "posted" && (
                          <form action={voidJournalEntry}>
                            <input type="hidden" name="id" value={entry.id} />
                            <button
                              type="submit"
                              className="text-sm text-slate-400 hover:text-red-600"
                            >
                              Void
                            </button>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
