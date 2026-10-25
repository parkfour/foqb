import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { createClient } from "@/lib/supabase/server";
import { canWrite, getCurrentOrgId, getCurrentUserRole, getUseAccountCodes } from "@/lib/org/current";
import { Attachments, type AttachmentInfo } from "@/components/attachments/attachments";
import { switchOrganization } from "@/app/(dashboard)/actions";
import { formatAccountLabel } from "@/lib/accounts/format";
import { registerHref } from "@/lib/reports/entry-links";
import { formatMoney } from "@/lib/money";
import { getBookCurrency } from "@/lib/org/book-currency";

interface EntryRow {
  id: string;
  entry_date: string;
  memo: string | null;
  status: "draft" | "posted" | "void";
  journal_lines: {
    id: string;
    account_id: string;
    description: string | null;
    debit: number;
    credit: number;
    accounts: { account_number: string; name: string } | null;
  }[];
  bank_transactions: { id: string; account_id: string | null; name: string | null; date: string }[];
}

// One journal entry: the bottom of a drill-down from a report figure that
// wasn't booked from the bank feed (those open in the register instead).
export default async function JournalEntryPage({ params }: { params: Promise<{ entryId: string }> }) {
  const { entryId } = await params;
  // It goes into a filter below, so only an id is let through.
  if (!/^[0-9a-f-]{36}$/i.test(entryId)) notFound();
  const orgId = await getCurrentOrgId();
  if (!orgId) redirect("/");

  const supabase = await createClient();
  const [{ data }, showAccountCodes, currency, role, { data: attachments }, { data: links }] = await Promise.all([
    supabase
      .from("journal_entries")
      .select(
        "id, entry_date, memo, status, journal_lines(id, account_id, description, debit, credit, accounts(account_number, name)), bank_transactions!bank_transactions_journal_entry_id_fkey(id, account_id, name, date)",
      )
      .eq("id", entryId)
      .eq("organization_id", orgId)
      .maybeSingle(),
    getUseAccountCodes(orgId),
    getBookCurrency(orgId),
    getCurrentUserRole(orgId),
    supabase
      .from("attachments")
      .select("id, file_name, content_type, size_bytes")
      .eq("journal_entry_id", entryId)
      .order("created_at"),
    supabase
      .from("inter_book_links")
      .select("org_a, entry_a, org_b, entry_b")
      .or(`entry_a.eq.${entryId},entry_b.eq.${entryId}`),
  ]);
  const entry = data as unknown as EntryRow | null;
  if (!entry) notFound();

  const formatCurrency = (value: number) => formatMoney(value, currency);
  const lines = entry.journal_lines ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          title={entry.memo || "Journal entry"}
          description={`${entry.entry_date} · ${entry.status}`}
        />
        <Link href="/journal" className="text-sm font-medium text-slate-600 underline hover:text-slate-900">
          ← Journal Entries
        </Link>
      </div>

      {await Promise.all(
        ((links ?? []) as { org_a: string; entry_a: string; org_b: string; entry_b: string }[]).map(async (link) => {
          const [otherOrg, otherEntry] = link.entry_a === entry.id ? [link.org_b, link.entry_b] : [link.org_a, link.entry_a];
          const { data: book } = await supabase.from("organizations").select("name").eq("id", otherOrg).maybeSingle();
          return (
            <form key={otherEntry} action={switchOrganization} className="text-sm text-slate-600">
              <input type="hidden" name="organizationId" value={otherOrg} />
              <input type="hidden" name="next" value={`/journal/${otherEntry}`} />
              Booked between your books: the other side is in {book?.name ?? "another book"}.{" "}
              <button type="submit" className="underline hover:text-slate-900">
                Open it
              </button>
            </form>
          );
        }),
      )}

      {(entry.bank_transactions ?? []).map((bt) =>
        bt.account_id ? (
          <Link
            key={bt.id}
            href={registerHref(bt.account_id, bt.id)}
            className="text-sm text-slate-600 underline hover:text-slate-900"
          >
            Booked from the bank feed: {bt.name ?? "transaction"} on {bt.date} — open it in the register
          </Link>
        ) : null,
      )}

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">Account</th>
                <th className="px-5 py-3 font-medium">Description</th>
                <th className="px-5 py-3 font-medium text-right">Debit</th>
                <th className="px-5 py-3 font-medium text-right">Credit</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-5 py-3 text-slate-900">
                    <Link
                      href={`/reports/account/${line.account_id}?end=${entry.entry_date}`}
                      className="underline hover:text-slate-600"
                    >
                      {line.accounts ? formatAccountLabel(line.accounts, showAccountCodes) : "—"}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-slate-600">{line.description ?? ""}</td>
                  <td className="px-5 py-3 text-right text-slate-900">
                    {Number(line.debit) ? formatCurrency(Number(line.debit)) : ""}
                  </td>
                  <td className="px-5 py-3 text-right text-slate-900">
                    {Number(line.credit) ? formatCurrency(Number(line.credit)) : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Attachments entryId={entry.id} initial={(attachments as AttachmentInfo[] | null) ?? []} canWrite={canWrite(role)} />
    </div>
  );
}
