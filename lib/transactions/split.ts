import type { SupabaseClient } from "@supabase/supabase-js";

export interface SplitLineInput {
  account_id: string;
  amount: number;
  memo?: string | null;
}

export interface SplitValidationResult {
  isValid: boolean;
  totalSplits: number;
  expectedTotal: number;
  difference: number;
}

export function validateSplitTransaction(
  parentAmount: number,
  splitLines: SplitLineInput[],
): SplitValidationResult {
  const expectedTotal = Math.round(Math.abs(parentAmount) * 100) / 100;
  const totalSplits = Math.round(
    splitLines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0) * 100,
  ) / 100;

  const difference = Math.round((expectedTotal - totalSplits) * 100) / 100;
  // Every line needs an account and a positive amount: a zero or negative
  // line would post a negative debit or credit.
  const allLinesValid =
    splitLines.length >= 1 &&
    splitLines.every((line) => Boolean(line.account_id) && Number(line.amount) > 0);
  const isValid = Math.abs(difference) < 0.005 && allLinesValid;

  return {
    isValid,
    totalSplits,
    expectedTotal,
    difference,
  };
}

export function buildSplitJournalLines(
  bankAccountId: string,
  parentAmount: number,
  parentMemo: string | null,
  splitLines: SplitLineInput[],
): { account_id: string; debit: number; credit: number; description: string }[] {
  const absParent = Math.round(Math.abs(parentAmount) * 100) / 100;

  if (parentAmount < 0) {
    // Money leaving bank (outflow/expense): bank account is credited, split category lines are debited
    const lines = splitLines.map((line) => ({
      account_id: line.account_id,
      debit: Math.round(Number(line.amount) * 100) / 100,
      credit: 0,
      description: line.memo?.trim() || parentMemo || "Split transaction",
    }));

    lines.push({
      account_id: bankAccountId,
      debit: 0,
      credit: absParent,
      description: parentMemo || "Bank Outflow",
    });

    return lines;
  } else {
    // Money entering bank (inflow/deposit): bank account is debited, split category lines are credited
    const lines: { account_id: string; debit: number; credit: number; description: string }[] = [
      {
        account_id: bankAccountId,
        debit: absParent,
        credit: 0,
        description: parentMemo || "Bank Inflow",
      },
    ];

    for (const line of splitLines) {
      lines.push({
        account_id: line.account_id,
        debit: 0,
        credit: Math.round(Number(line.amount) * 100) / 100,
        description: line.memo?.trim() || parentMemo || "Split transaction",
      });
    }

    return lines;
  }
}

export async function submitSplitTransaction(
  supabase: SupabaseClient,
  bankTransactionId: string,
  splitLines: SplitLineInput[],
): Promise<{ success: boolean; error?: string }> {

  const { data: tx, error: txError } = await supabase
    .from("bank_transactions")
    .select("id, organization_id, account_id, date, name, amount, status")
    .eq("id", bankTransactionId)
    .maybeSingle();

  if (txError || !tx) {
    return { success: false, error: "Bank transaction not found" };
  }

  if (tx.status !== "unreconciled" || !tx.account_id) {
    return { success: false, error: "Only unreconciled transactions can be split" };
  }

  const validation = validateSplitTransaction(Number(tx.amount), splitLines);
  if (!validation.isValid) {
    return {
      success: false,
      error:
        validation.difference === 0
          ? "Every split line needs an account and an amount above zero"
          : `Split amounts must match transaction total exactly (difference: ${validation.difference.toFixed(2)})`,
    };
  }

  const lines = buildSplitJournalLines(tx.account_id, Number(tx.amount), tx.name, splitLines);

  const { error: postError } = await supabase.rpc("post_journal_entry", {
    p_org_id: tx.organization_id,
    p_entry_date: tx.date,
    p_memo: tx.name,
    p_lines: lines,
    p_bank_transaction_id: tx.id,
  });

  if (postError) {
    return { success: false, error: postError.message };
  }

  return { success: true };
}
