import { PageHeader } from "@/components/ui/page-header";
import { createClient } from "@/lib/supabase/server";
import { canWrite, getCurrentOrgId, getCurrentUserRole } from "@/lib/org/current";
import { TransactionRegister, type RegisterTransaction, type RegisterAccount } from "@/components/transactions/transaction-register";
import { TimezoneChangeNotice } from "@/components/ui/timezone-change-notice";
import { pairTransfers } from "@/lib/bank/transfers";
import { PAGE_SIZE, readAllRows } from "@/lib/supabase/read-all";

const TXN_COLUMNS =
  "id, date, name, amount, status, cleared, account_id, journal_entry_id, reopen_blocker, recategorize_blocker, accounts(name), journal_entries(status, journal_lines(id, account_id, description, debit, credit, reconciliation_id, accounts(name)))";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RegisterPageProps {
  searchParams: Promise<{ account?: string; pages?: string }>;
}

export default async function RegisterPage({ searchParams }: RegisterPageProps) {
  const params = await searchParams;
  const account = UUID.test(params.account ?? "") ? params.account : undefined;
  const pages = params.pages;
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

  // Read one row past maxRows, to know whether there are older ones.
  const readTransactions = () =>
    readAllRows<unknown>((from, to) => {
      let query = supabase.from("bank_transactions").select(TXN_COLUMNS).eq("organization_id", orgId);
      if (account) query = query.eq("account_id", account);
      return query.order("date", { ascending: false }).order("id").range(from, to);
    }, maxRows);

  const [{ data: rawAccounts }, txnRows] = await Promise.all([
    supabase
      .from("accounts")
      .select("id, account_number, name, type")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .order("account_number"),
    readTransactions(),
  ]);
  const hasOlder = txnRows.length > maxRows;
  const rawTxns = hasOlder ? txnRows.slice(0, maxRows) : txnRows;

  const accounts: RegisterAccount[] = (rawAccounts ?? []).map((a) => ({
    id: a.id,
    account_number: a.account_number,
    name: a.name,
    type: a.type,
  }));

interface RawJournalLine {
  id: string;
  account_id: string;
  description?: string | null;
  debit: number;
  credit: number;
  reconciliation_id?: string | null;
  accounts?: { name: string } | null;
}

interface RawTx {
  id: string;
  date: string;
  name: string;
  amount: number;
  status: string;
  cleared?: boolean | null;
  account_id?: string | null;
  journal_entry_id?: string | null;
  reopen_blocker?: string | null;
  recategorize_blocker?: string | null;
  accounts?: { name: string } | null;
  journal_entries?: {
    status: string;
    journal_lines?: RawJournalLine[];
  } | null;
}

  const transactions: RegisterTransaction[] = ((rawTxns as unknown as RawTx[]) ?? []).map((t) => {
    const journalLines: RawJournalLine[] = t.journal_entries?.journal_lines ?? [];
    const nonBankLines = journalLines.filter((l) => l.account_id !== t.account_id);
    const isSplit = nonBankLines.length > 1;

    let categoryName = t.status === "ignored" ? "Ignored" : "Uncategorized";
    let categoryId: string | null = null;

    if (isSplit) {
      categoryName = "Split";
    } else if (nonBankLines.length === 1) {
      categoryName = nonBankLines[0].accounts?.name || "Categorized";
      categoryId = nonBankLines[0].account_id;
    }

    // Reconciled means a bank reconciliation covers the bank account's line.
    const isReconciled = journalLines.some((l) => l.account_id === t.account_id && Boolean(l.reconciliation_id));
    const status: "pending" | "cleared" | "reconciled" = isReconciled
      ? "reconciled"
      : t.cleared
      ? "cleared"
      : "pending";

    return {
      id: t.id,
      date: t.date,
      account_id: t.account_id || "",
      account_name: t.accounts?.name || "Primary Account",
      name: t.name,
      amount: Number(t.amount),
      category_id: categoryId,
      category_name: categoryName,
      is_split: isSplit,
      status,
      categorized: t.status !== "unreconciled",
      journal_entry_id: t.journal_entry_id,
      reopen_blocker: t.reopen_blocker ?? null,
      recategorize_blocker: t.recategorize_blocker ?? null,
    };
  });

  const transfers = pairTransfers(transactions.filter((t) => !t.categorized));
  for (const t of transactions) {
    const other = transfers.get(t.id);
    if (other) t.transfer = { account_id: other.account_id, account_name: other.account_name };
  }

  const listedDates = transactions.map((t) => t.date).sort();

  return (
    <div className="flex flex-col gap-6">
      <TimezoneChangeNotice from={listedDates[0]} to={listedDates.at(-1)} />
      <PageHeader
        title="Transaction Register"
        description="Your bank feed, checkbook-style: mark transactions cleared, categorize or split the new ones."
      />
      <TransactionRegister
        key={`${account ?? "all"}-${pageCount}`}
        transactions={transactions}
        accounts={accounts}
        canWrite={canWrite(role)}
        account={account}
        olderHref={hasOlder ? `/register?pages=${pageCount + 1}` : null}
      />
    </div>
  );
}
