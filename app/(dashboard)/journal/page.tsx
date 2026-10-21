import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { createClient } from "@/lib/supabase/server";
import { canWrite, getCurrentOrgId, getCurrentUserRole } from "@/lib/org/current";
import { voidJournalEntry } from "../transactions/actions";

const PER_PAGE = 50;

interface JournalPageProps {
  searchParams: Promise<{ q?: string; page?: string }>;
}

interface EntryRow {
  id: string;
  entry_date: string;
  memo: string | null;
  status: string;
  journal_lines: { debit: number; accounts: { name: string } | null }[];
  bank_transactions: { id: string }[];
}

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

// Every journal entry, newest first, to find one the register doesn't show
// (an opening balance, a manual entry) and void it.
export default async function JournalPage({ searchParams }: JournalPageProps) {
  const params = await searchParams;
  const q = (params.q ?? "").trim().slice(0, 100);
  const page = Math.max(0, Math.floor(Number(params.page)) || 0);
  const orgId = await getCurrentOrgId();

  if (!orgId) {
    return (
      <div>
        <PageHeader title="Journal Entries" description="Every entry in the books." />
        <p className="mt-4 text-sm text-slate-500">Select or create an organization first.</p>
      </div>
    );
  }

  const supabase = await createClient();
  const userCanWrite = canWrite(await getCurrentUserRole(orgId));
  let query = supabase
    .from("journal_entries")
    .select("id, entry_date, memo, status, journal_lines(debit, accounts(name)), bank_transactions(id)")
    .eq("organization_id", orgId)
    .in("status", ["posted", "void"]);
  if (q) query = query.ilike("memo", `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  const { data } = await query
    .order("entry_date", { ascending: false })
    .order("id")
    .range(page * PER_PAGE, page * PER_PAGE + PER_PAGE); // one extra: is there an older page?
  const rows = (data ?? []) as unknown as EntryRow[];
  const entries = rows.slice(0, PER_PAGE);
  const pageLink = (n: number) => `/journal?${new URLSearchParams({ ...(q ? { q } : {}), page: String(n) })}`;

  return (
    <div className="space-y-4">
      <PageHeader title="Journal Entries" description="Every entry in the books, newest first." />

      <form className="flex gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search memos (e.g. Opening balance)"
          aria-label="Search memos"
          className="w-full max-w-sm rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
          Search
        </button>
      </form>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-5 py-3 font-medium">Date</th>
              <th className="px-5 py-3 font-medium">Memo</th>
              <th className="px-5 py-3 font-medium">Accounts</th>
              <th className="px-5 py-3 text-right font-medium">Amount</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-6 text-center text-slate-500">
                  {q ? "No entries match." : "No journal entries yet."}
                </td>
              </tr>
            ) : (
              entries.map((entry) => {
                const amount = entry.journal_lines.reduce((sum, line) => sum + Number(line.debit), 0);
                const accounts = [...new Set(entry.journal_lines.map((l) => l.accounts?.name).filter(Boolean))];
                const fromFeed = entry.bank_transactions.length > 0;
                return (
                  <tr key={entry.id} className="border-b border-slate-100 last:border-0">
                    <td className="whitespace-nowrap px-5 py-3 text-slate-600">{entry.entry_date}</td>
                    <td className="px-5 py-3 text-slate-900">{entry.memo ?? "—"}</td>
                    <td className="px-5 py-3 text-xs text-slate-600">{accounts.join(", ")}</td>
                    <td className="px-5 py-3 text-right font-mono text-slate-900">{money.format(amount)}</td>
                    <td className="px-5 py-3 text-xs text-slate-600">{entry.status}</td>
                    <td className="px-5 py-3 text-right text-xs">
                      {userCanWrite && entry.status === "posted" && fromFeed && (
                        <span className="text-slate-400">re-open it in the register</span>
                      )}
                      {userCanWrite && entry.status === "posted" && !fromFeed && (
                        <form action={voidJournalEntry}>
                          <input type="hidden" name="id" value={entry.id} />
                          <button type="submit" className="text-sm text-slate-400 hover:text-red-600">
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

      <div className="flex justify-between text-sm">
        {page > 0 ? (
          <Link href={pageLink(page - 1)} className="text-slate-600 hover:text-slate-900">
            ← Newer
          </Link>
        ) : (
          <span />
        )}
        {rows.length > PER_PAGE && (
          <Link href={pageLink(page + 1)} className="text-slate-600 hover:text-slate-900">
            Older →
          </Link>
        )}
      </div>
    </div>
  );
}
