import { createClient } from "@/lib/supabase/server";
import { signedAmount, type ReconciliationLine } from "./shared";

export { signedAmount, type ReconciliationLine } from "./shared";

export interface Reconciliation {
  id: string;
  organizationId: string;
  accountId: string;
  accountName: string;
  accountType: "asset" | "liability" | "equity" | "revenue" | "expense";
  statementDate: string;
  statementEndingBalance: number;
  status: "in_progress" | "completed";
  createdAt: string;
  completedAt: string | null;
}

export async function fetchReconciliation(
  orgId: string,
  reconciliationId: string,
): Promise<Reconciliation | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("bank_reconciliations")
    .select(
      "id, organization_id, account_id, statement_date, statement_ending_balance, status, created_at, completed_at, accounts(name, type)",
    )
    .eq("id", reconciliationId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (!data) return null;

  const row = data as unknown as {
    id: string;
    organization_id: string;
    account_id: string;
    statement_date: string;
    statement_ending_balance: number;
    status: "in_progress" | "completed";
    created_at: string;
    completed_at: string | null;
    accounts: { name: string; type: Reconciliation["accountType"] } | null;
  };

  return {
    id: row.id,
    organizationId: row.organization_id,
    accountId: row.account_id,
    accountName: row.accounts?.name ?? "Unknown account",
    accountType: row.accounts?.type ?? "asset",
    statementDate: row.statement_date,
    statementEndingBalance: Number(row.statement_ending_balance),
    status: row.status,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

// The account's reconciled balance going into this reconciliation: the net
// effect of every journal line already cleared by a prior (or this) one.
export async function fetchBeginningBalance(
  accountId: string,
  accountType: string,
  excludeReconciliationId: string,
): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("journal_lines")
    .select("debit, credit")
    .eq("account_id", accountId)
    .not("reconciliation_id", "is", null)
    .neq("reconciliation_id", excludeReconciliationId);

  const lines = (data as { debit: number; credit: number }[] | null) ?? [];
  return lines.reduce((sum, l) => sum + signedAmount(accountType, Number(l.debit), Number(l.credit)), 0);
}

// Posted journal lines against this account that haven't cleared any
// reconciliation yet, dated on or before the statement date.
export async function fetchUnclearedLines(
  accountId: string,
  statementDate: string,
): Promise<ReconciliationLine[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("journal_lines")
    .select(
      "id, description, debit, credit, journal_entries!inner(entry_date, memo, status)",
    )
    .eq("account_id", accountId)
    .is("reconciliation_id", null)
    .eq("journal_entries.status", "posted")
    .lte("journal_entries.entry_date", statementDate)
    .order("entry_date", { referencedTable: "journal_entries", ascending: true });

  const rows =
    (data as unknown as {
      id: string;
      description: string | null;
      debit: number;
      credit: number;
      journal_entries: { entry_date: string; memo: string | null };
    }[] | null) ?? [];

  return rows.map((row) => ({
    id: row.id,
    entryDate: row.journal_entries.entry_date,
    memo: row.journal_entries.memo,
    description: row.description,
    debit: Number(row.debit),
    credit: Number(row.credit),
  }));
}
