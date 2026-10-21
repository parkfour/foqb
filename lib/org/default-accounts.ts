export interface DefaultAccount {
  account_number: string;
  name: string;
  type: "asset" | "liability" | "equity" | "revenue" | "expense";
}

// 1000s asset, 2000s liability, 3000s equity, 4000s revenue, 5000s expense —
// also used to auto-assign a number when an org has account codes turned
// off (organizations.use_account_codes), since account_number stays
// required and unique in the schema regardless of the display setting.
export const ACCOUNT_TYPE_BASE: Record<DefaultAccount["type"], number> = {
  asset: 1000,
  liability: 2000,
  equity: 3000,
  revenue: 4000,
  expense: 5000,
};

// A minimal starter chart of accounts so a brand-new organization isn't a
// completely blank slate. Numbering follows the standard convention already
// used elsewhere in the app (1000s asset, 2000s liability, 3000s equity,
// 4000s revenue, 5000s expense).
export const DEFAULT_CHART_OF_ACCOUNTS: DefaultAccount[] = [
  { account_number: "1000", name: "Cash", type: "asset" },
  { account_number: "1200", name: "Accounts Receivable", type: "asset" },
  { account_number: "2000", name: "Accounts Payable", type: "liability" },
  { account_number: "3000", name: "Owner's Equity", type: "equity" },
  { account_number: "4000", name: "Revenue", type: "revenue" },
  { account_number: "5000", name: "Operating Expenses", type: "expense" },
];
