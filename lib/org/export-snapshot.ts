import type { SupabaseClient } from "@supabase/supabase-js";

// A full JSON export of everything under one organization, for an owner to
// download as a safety net — most relevant now that a Site Admin can
// suspend or delete an org. Deliberately excludes enrollments.access_token
// and enrollments.cursor: never export secrets, even encrypted ones.

// Each backup key and what it's read from. Embedded children (an entry's
// lines) come back with their parent; the API's row limit only applies to
// the top level.
const TABLES: { key: string; table: string; columns: string }[] = [
  { key: "accounts", table: "accounts", columns: "*" },
  { key: "journal_entries", table: "journal_entries", columns: "*, journal_lines(*)" },
  { key: "customers", table: "customers", columns: "*" },
  { key: "vendors", table: "vendors", columns: "*" },
  { key: "invoices", table: "invoices", columns: "*, invoice_lines(*)" },
  { key: "bills", table: "bills", columns: "*, bill_lines(*)" },
  { key: "invoice_payments", table: "invoice_payments", columns: "*" },
  { key: "bill_payments", table: "bill_payments", columns: "*" },
  { key: "items", table: "items", columns: "*" },
  { key: "inventory_items", table: "inventory_items", columns: "*" },
  { key: "fixed_assets", table: "fixed_assets", columns: "*" },
  { key: "recurring_invoices", table: "recurring_invoices", columns: "*, recurring_invoice_lines(*)" },
  { key: "recurring_bills", table: "recurring_bills", columns: "*, recurring_bill_lines(*)" },
  { key: "bank_transactions", table: "bank_transactions", columns: "*" },
  { key: "bank_reconciliations", table: "bank_reconciliations", columns: "*" },
  { key: "categorization_rules", table: "categorization_rules", columns: "*" },
  { key: "properties", table: "properties", columns: "*" },
  { key: "monthly_budgets", table: "monthly_budgets", columns: "*" },
  { key: "net_worth_snapshots", table: "net_worth_snapshots", columns: "*" },
  { key: "timezone_changes", table: "organization_timezone_changes", columns: "*" },
  // Plugins' own values (lib/plugins/data.ts).
  { key: "plugin_data", table: "plugin_data", columns: "*" },
  {
    // Without the encrypted taxpayer ids.
    key: "mortgage_notes",
    table: "mortgage_notes",
    columns:
      "id, organization_id, name, borrower_name, borrower_address, lender_name, lender_address, property_address, origination_date, original_principal, annual_rate, term_months, first_payment_date, payment_amount, escrow_amount, match_text, note_account_id, interest_account_id, escrow_account_id, created_at",
  },
  {
    key: "enrollments",
    table: "enrollments",
    columns: "id, organization_id, external_item_id, institution_name, status, disconnect_reason, created_at",
  },
];

// Small enough to be under any sensible API row limit.
const PAGE_SIZE = 500;

// Every row, a page at a time. Stops on an empty page rather than a short
// one, so a server row limit below PAGE_SIZE can't end it early. Any error
// fails the whole backup: a backup missing rows is worse than none.
async function readAll(supabase: SupabaseClient, table: string, columns: string, orgId: string): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (let from = 0; ; ) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .eq("organization_id", orgId)
      .order("id")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Couldn't read ${table} for the backup: ${error.message}`);
    if (!data || data.length === 0) return rows;
    rows.push(...data);
    from += data.length;
  }
}

export async function buildOrganizationSnapshot(
  supabase: SupabaseClient,
  orgId: string,
): Promise<Record<string, unknown>> {
  const [organization, ...tables] = await Promise.all([
    supabase
      .from("organizations")
      .select(
        "id, name, status, period_lock_date, inventory_enabled, use_account_codes, tax_form, ar_account_id, ap_account_id, tax_payable_account_id, default_tax_rate, workspace_type, timezone, currency, created_at",
      )
      .eq("id", orgId)
      .maybeSingle(),
    ...TABLES.map(({ table, columns }) => readAll(supabase, table, columns, orgId)),
  ]);
  if (organization.error || !organization.data) {
    throw new Error(`Couldn't read the organization for the backup: ${organization.error?.message ?? "not found"}`);
  }

  return {
    exported_at: new Date().toISOString(),
    organization: organization.data,
    ...Object.fromEntries(TABLES.map(({ key }, i) => [key, tables[i]])),
  };
}
