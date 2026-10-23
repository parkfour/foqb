import { PageHeader } from "@/components/ui/page-header";
import { createClient } from "@/lib/supabase/server";
import { canWrite, getCurrentOrgId, getCurrentUserRole } from "@/lib/org/current";
import { TransactionRegister, type RegisterAccount } from "@/components/transactions/transaction-register";
import { TimezoneChangeNotice } from "@/components/ui/timezone-change-notice";
import { registerRows, type RawTx } from "@/lib/register/rows";
import { PAGE_SIZE, readAllRows } from "@/lib/supabase/read-all";

const TXN_COLUMNS =
  "id, date, name, amount, status, cleared, account_id, journal_entry_id, accounts(name), journal_entries(status, journal_lines(id, account_id, description, debit, credit, reconciliation_id, accounts(name)))";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RegisterPageProps {
  searchParams: Promise<{ account?: string; pages?: string; tx?: string }>;
}

export default async function RegisterPage({ searchParams }: RegisterPageProps) {
  const params = await searchParams;
  const account = UUID.test(params.account ?? "") ? params.account : undefined;
  const pages = params.pages;
  const focusId = UUID.test(params.tx ?? "") ? params.tx : undefined;
  // One account: its whole history, so the running total starts at the
  // beginning. All accounts: the newest `pages` pages, with "Load older".
  const pageCount = Math.max(1, Math.floor(Number(pages)) || 1);
  const maxRows = account ? Infinity : pageCount * PAGE_SIZE;
  const orgId = await getCurrentOrgId();

  if (!orgId) {
    return (
      <div>
        <PageHeader title="Transaction Register" description="Dense checkbook-style register." />
        <p className="mt-4 text-sm text-slate-500">Select or create an organization first.</p>
      </div>
    );
  }

  const supabase = await createClient();
  const role = await getCurrentUserRole(orgId);

  const { data: rawAccounts } = await supabase
    .from("accounts")
    .select("id, account_number, name, type, has_bank_feed")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .order("account_number");
  // An account no bank feeds, like an income or expense category: the
  // transactions categorized to it, splits included, rather than none.
  const byCategory = Boolean(account) && rawAccounts?.find((a) => a.id === account)?.has_bank_feed === false;

  // Up to maxRows, a page at a time; reading past it (to see whether there
  // are older rows) would read a whole extra page of joins and checks.
  const rawTxns = await readAllRows<unknown>((from, to) => {
    let query = supabase
      .from("bank_transactions")
      .select(byCategory ? `${TXN_COLUMNS}, category:journal_entries!inner(journal_lines!inner(account_id))` : TXN_COLUMNS)
      .eq("organization_id", orgId);
    if (byCategory) query = query.eq("category.journal_lines.account_id", account!);
    else if (account) query = query.eq("account_id", account);
    return query.order("date", { ascending: false }).order("id").range(from, to);
  }, maxRows - 1);
  // Older rows, for "Load older": the next one's id is enough to tell.
  const { data: next } =
    rawTxns.length >= maxRows
      ? await supabase
          .from("bank_transactions")
          .select("id")
          .eq("organization_id", orgId)
          .order("date", { ascending: false })
          .order("id")
          .range(maxRows, maxRows)
      : { data: [] };
  const hasOlder = (next ?? []).length > 0;

  const accounts: RegisterAccount[] = (rawAccounts ?? []).map((a) => ({
    id: a.id,
    account_number: a.account_number,
    name: a.name,
    type: a.type,
    has_bank_feed: a.has_bank_feed,
  }));

  // Why each row can't be re-opened or re-categorized, asked once for all of
  // them (bank_transaction_blockers) rather than as a column per row.
  const raw = (rawTxns as unknown as RawTx[]) ?? [];
  const { data: blockerRows, error: blockersError } = raw.length
    ? await supabase.rpc("bank_transaction_blockers", { p_ids: raw.map((t) => t.id) })
    : { data: [], error: null };
  // Without them every row offers Re-open; the database still refuses one it
  // can't do, with its reason.
  if (blockersError) console.error("Couldn't read the register's blockers", blockersError);
  const blockers = new Map(
    ((blockerRows ?? []) as { id: string; reopen_blocker: string | null; recategorize_blocker: string | null }[]).map((b) => [b.id, b]),
  );
  const transactions = registerRows(
    raw.map((t) => ({
      ...t,
      reopen_blocker: blockers.get(t.id)?.reopen_blocker ?? null,
      recategorize_blocker: blockers.get(t.id)?.recategorize_blocker ?? null,
    })),
  );

  const listedDates = transactions.map((t) => t.date).sort();

  return (
    <div className="flex flex-col gap-6">
      <TimezoneChangeNotice from={listedDates[0]} to={listedDates.at(-1)} />
      <PageHeader
        title="Transaction Register"
        description="Your bank feed, checkbook-style: mark transactions cleared, categorize or split the new ones."
      />
      <TransactionRegister
        key={`${account ?? "all"}-${pageCount}-${focusId ?? ""}`}
        transactions={transactions}
        accounts={accounts}
        canWrite={canWrite(role)}
        account={account}
        olderHref={hasOlder ? `/register?pages=${pageCount + 1}` : null}
        focusId={focusId}
      />
    </div>
  );
}
