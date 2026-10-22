import { PageHeader } from "@/components/ui/page-header";
import { createClient } from "@/lib/supabase/server";
import { canWrite, getCurrentOrgId, getCurrentUserRole } from "@/lib/org/current";
import { TransactionRegister, type RegisterAccount } from "@/components/transactions/transaction-register";
import { TimezoneChangeNotice } from "@/components/ui/timezone-change-notice";
import { registerRows, type RawTx } from "@/lib/register/rows";
import { PAGE_SIZE, readAllRows } from "@/lib/supabase/read-all";

const TXN_COLUMNS =
  "id, date, name, amount, status, cleared, account_id, journal_entry_id, reopen_blocker, recategorize_blocker, accounts(name), journal_entries(status, journal_lines(id, account_id, description, debit, credit, reconciliation_id, accounts(name)))";

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

  // Read one row past maxRows, to know whether there are older ones.
  const txnRows = await readAllRows<unknown>((from, to) => {
    let query = supabase
      .from("bank_transactions")
      .select(byCategory ? `${TXN_COLUMNS}, category:journal_entries!inner(journal_lines!inner(account_id))` : TXN_COLUMNS)
      .eq("organization_id", orgId);
    if (byCategory) query = query.eq("category.journal_lines.account_id", account!);
    else if (account) query = query.eq("account_id", account);
    return query.order("date", { ascending: false }).order("id").range(from, to);
  }, maxRows);
  const hasOlder = txnRows.length > maxRows;
  const rawTxns = hasOlder ? txnRows.slice(0, maxRows) : txnRows;

  const accounts: RegisterAccount[] = (rawAccounts ?? []).map((a) => ({
    id: a.id,
    account_number: a.account_number,
    name: a.name,
    type: a.type,
    has_bank_feed: a.has_bank_feed,
  }));

  const transactions = registerRows((rawTxns as unknown as RawTx[]) ?? []);

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
