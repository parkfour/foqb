// Revaluing a foreign-currency account: what its balance is worth at a new
// rate, and the entry that moves the books there. Balances are signed the
// account's normal way (assets debit, liabilities credit), so a positive
// change raises the account either way: a gain on an asset, a loss on a
// liability. The account's line moves no foreign currency (0).

const round2 = (n: number) => Math.round(n * 100) / 100;

export function revaluationLines(
  account: { account_id: string; type: "asset" | "liability"; foreign_balance: number; book_balance: number },
  rate: number,
  gainLossAccountId: string,
): { account_id: string; debit: number; credit: number; foreign_amount?: number }[] | null {
  const change = round2(round2(account.foreign_balance * rate) - account.book_balance);
  if (change === 0) return null;
  const raisesAccount = change > 0;
  const accountDebits = (account.type === "asset") === raisesAccount;
  const amount = Math.abs(change);
  return [
    { account_id: account.account_id, debit: accountDebits ? amount : 0, credit: accountDebits ? 0 : amount, foreign_amount: 0 },
    { account_id: gainLossAccountId, debit: accountDebits ? 0 : amount, credit: accountDebits ? amount : 0 },
  ];
}
