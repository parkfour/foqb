import { createClient } from "@/lib/supabase/server";

// Sales tax by rate for a period (by invoice date), with what's been paid
// to each account's agency in the period and what's still owed at its end.
// An invoice with a single typed-in rate counts under "Single rate".

export interface SalesTaxRow {
  key: string;
  name: string;
  accountId: string | null;
  taxableSales: number;
  collected: number;
}

interface InvoiceRow {
  status: string;
  tax_amount: number | string;
  invoice_lines: { amount: number | string }[];
  invoice_taxes: { tax_rate_id: string | null; name: string; amount: number | string; account_id: string }[];
}

const round = (n: number) => Math.round(n * 100) / 100;

export function summarizeSalesTax(invoices: InvoiceRow[], singleRateAccountId: string | null): SalesTaxRow[] {
  const rows = new Map<string, SalesTaxRow>();
  const add = (key: string, name: string, accountId: string | null, sales: number, tax: number) => {
    const row = rows.get(key) ?? { key, name, accountId, taxableSales: 0, collected: 0 };
    row.taxableSales = round(row.taxableSales + sales);
    row.collected = round(row.collected + tax);
    rows.set(key, row);
  };
  for (const inv of invoices) {
    if (inv.status === "void") continue;
    const subtotal = inv.invoice_lines.reduce((s, l) => s + Number(l.amount), 0);
    if (inv.invoice_taxes.length > 0) {
      for (const t of inv.invoice_taxes) add(t.tax_rate_id ?? `name:${t.name}`, t.name, t.account_id, subtotal, Number(t.amount));
    } else if (Number(inv.tax_amount) > 0) {
      add("single", "Single rate", singleRateAccountId, subtotal, Number(inv.tax_amount));
    }
  }
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export interface SalesTaxAccountRow {
  accountId: string;
  name: string;
  paid: number;
  owed: number;
}

export async function fetchSalesTax(orgId: string, start: string, end: string) {
  const supabase = await createClient();
  const [{ data: invoices, error }, { data: org }] = await Promise.all([
    supabase
      .from("invoices")
      .select("status, tax_amount, invoice_lines(amount), invoice_taxes(tax_rate_id, name, amount, account_id)")
      .eq("organization_id", orgId)
      .gte("invoice_date", start)
      .lte("invoice_date", end),
    supabase.from("organizations").select("tax_payable_account_id").eq("id", orgId).maybeSingle(),
  ]);
  if (error) throw error;
  const rows = summarizeSalesTax((invoices ?? []) as unknown as InvoiceRow[], (org?.tax_payable_account_id as string | null) ?? null);

  // The accounts behind them: every rate's, and the single rate's.
  const { data: rateAccounts } = await supabase.from("sales_tax_rates").select("account_id").eq("organization_id", orgId);
  const accountIds = [
    ...new Set(
      [...rows.map((r) => r.accountId), ...((rateAccounts ?? []) as { account_id: string | null }[]).map((r) => r.account_id), org?.tax_payable_account_id as string | null].filter(
        (id): id is string => !!id,
      ),
    ),
  ];
  if (accountIds.length === 0) return { rows, accounts: [] as SalesTaxAccountRow[] };

  const [{ data: balances }, { data: lines }] = await Promise.all([
    supabase.rpc("get_balance_sheet", { p_org_id: orgId, p_as_of_date: end }),
    supabase
      .from("journal_lines")
      .select("account_id, debit, journal_entries!inner(entry_date, status)")
      .in("account_id", accountIds)
      .eq("journal_entries.status", "posted")
      .gte("journal_entries.entry_date", start)
      .lte("journal_entries.entry_date", end)
      .gt("debit", 0),
  ]);
  const balanceRows = (balances ?? []) as { account_id: string | null; name: string; balance: number | string }[];
  const accounts = accountIds.map((id) => {
    const b = balanceRows.find((r) => r.account_id === id);
    const paid = ((lines ?? []) as { account_id: string; debit: number | string }[])
      .filter((l) => l.account_id === id)
      .reduce((s, l) => s + Number(l.debit), 0);
    return { accountId: id, name: b?.name ?? "Sales tax payable", paid: round(paid), owed: round(Number(b?.balance ?? 0)) };
  });
  return { rows, accounts };
}
