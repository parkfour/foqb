interface AccountLabelInput {
  account_number: string | null;
  name: string;
}

// Shared by every account picker/list in the app so the "Use account
// numbers" org setting (organizations.use_account_codes) hides the number
// prefix consistently everywhere, not just in the Chart of Accounts page.
// account_number is nullable here only for synthetic report rows (e.g. a
// balance sheet's retained-earnings line) that have no real account behind
// them — real accounts always have one regardless of the org setting.
export function formatAccountLabel(account: AccountLabelInput, showCodes: boolean): string {
  return showCodes && account.account_number
    ? `${account.account_number} — ${account.name}`
    : account.name;
}
