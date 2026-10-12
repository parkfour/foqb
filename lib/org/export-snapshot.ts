import type { SupabaseClient } from "@supabase/supabase-js";

// A full JSON export of everything under one organization, for an owner to
// download as a safety net — most relevant now that a Site Admin can
// suspend or delete an org. Deliberately excludes enrollments.access_token
// and enrollments.cursor: never export secrets, even encrypted ones.
export async function buildOrganizationSnapshot(
  supabase: SupabaseClient,
  orgId: string,
): Promise<Record<string, unknown>> {
  const [
    organization,
    accounts,
    journalEntries,
    customers,
    vendors,
    invoices,
    bills,
    invoicePayments,
    billPayments,
    items,
    inventoryItems,
    fixedAssets,
    recurringInvoices,
    recurringBills,
    bankTransactions,
    bankReconciliations,
    categorizationRules,
    enrollments,
  ] = await Promise.all([
    supabase
      .from("organizations")
      .select(
        "id, name, status, period_lock_date, inventory_enabled, use_account_codes, tax_form, ar_account_id, ap_account_id, tax_payable_account_id, default_tax_rate, created_at",
      )
      .eq("id", orgId)
      .maybeSingle(),
    supabase.from("accounts").select("*").eq("organization_id", orgId),
    supabase.from("journal_entries").select("*, journal_lines(*)").eq("organization_id", orgId),
    supabase.from("customers").select("*").eq("organization_id", orgId),
    supabase.from("vendors").select("*").eq("organization_id", orgId),
    supabase.from("invoices").select("*, invoice_lines(*)").eq("organization_id", orgId),
    supabase.from("bills").select("*, bill_lines(*)").eq("organization_id", orgId),
    supabase.from("invoice_payments").select("*").eq("organization_id", orgId),
    supabase.from("bill_payments").select("*").eq("organization_id", orgId),
    supabase.from("items").select("*").eq("organization_id", orgId),
    supabase.from("inventory_items").select("*").eq("organization_id", orgId),
    supabase.from("fixed_assets").select("*").eq("organization_id", orgId),
    supabase
      .from("recurring_invoices")
      .select("*, recurring_invoice_lines(*)")
      .eq("organization_id", orgId),
    supabase.from("recurring_bills").select("*, recurring_bill_lines(*)").eq("organization_id", orgId),
    supabase.from("bank_transactions").select("*").eq("organization_id", orgId),
    supabase.from("bank_reconciliations").select("*").eq("organization_id", orgId),
    supabase.from("categorization_rules").select("*").eq("organization_id", orgId),
    supabase
      .from("enrollments")
      .select("id, organization_id, external_item_id, institution_name, status, disconnect_reason, created_at")
      .eq("organization_id", orgId),
  ]);

  return {
    exported_at: new Date().toISOString(),
    organization: organization.data,
    accounts: accounts.data ?? [],
    journal_entries: journalEntries.data ?? [],
    customers: customers.data ?? [],
    vendors: vendors.data ?? [],
    invoices: invoices.data ?? [],
    bills: bills.data ?? [],
    invoice_payments: invoicePayments.data ?? [],
    bill_payments: billPayments.data ?? [],
    items: items.data ?? [],
    inventory_items: inventoryItems.data ?? [],
    fixed_assets: fixedAssets.data ?? [],
    recurring_invoices: recurringInvoices.data ?? [],
    recurring_bills: recurringBills.data ?? [],
    bank_transactions: bankTransactions.data ?? [],
    bank_reconciliations: bankReconciliations.data ?? [],
    categorization_rules: categorizationRules.data ?? [],
    enrollments: enrollments.data ?? [],
  };
}
