import type { SupabaseClient } from "@supabase/supabase-js";

interface ControlAccountLookup {
  settingColumn: "ar_account_id" | "ap_account_id" | "tax_payable_account_id";
  type: "asset" | "liability";
  namePattern: string;
  label: string;
}

// Looks up the org's AR/AP control account: first the explicit setting
// (organizations.ar_account_id/ap_account_id, set in Settings), then by
// type + name (matches DEFAULT_CHART_OF_ACCOUNTS' "Accounts Receivable"/
// "Accounts Payable" exactly, and any renamed/renumbered equivalent).
// Deliberately NOT number-based as a fallback: a bulk-imported chart of
// accounts (e.g. from CSV/QuickBooks) can reuse account_number 1200/2000
// for something unrelated of the same type, which a number-only lookup
// would silently misidentify as the control account.
async function findControlAccount(
  supabase: SupabaseClient,
  organizationId: string,
  lookup: ControlAccountLookup,
): Promise<{ id: string } | { error: string }> {
  const { data: org } = await supabase
    .from("organizations")
    .select(lookup.settingColumn)
    .eq("id", organizationId)
    .maybeSingle();

  const explicitId = (org as Record<string, string | null> | null)?.[lookup.settingColumn];
  if (explicitId) return { id: explicitId };

  const { data } = await supabase
    .from("accounts")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("type", lookup.type)
    .ilike("name", lookup.namePattern)
    .limit(1)
    .maybeSingle();

  if (data) return { id: data.id as string };

  return {
    error: `No ${lookup.label} account found — create a ${lookup.type} account with a name containing "${lookup.namePattern.replace(/%/g, "")}", or set one explicitly in Settings`,
  };
}

export function findAccountsReceivableAccount(supabase: SupabaseClient, organizationId: string) {
  return findControlAccount(supabase, organizationId, {
    settingColumn: "ar_account_id",
    type: "asset",
    namePattern: "%receivable%",
    label: "Accounts Receivable",
  });
}

export function findAccountsPayableAccount(supabase: SupabaseClient, organizationId: string) {
  return findControlAccount(supabase, organizationId, {
    settingColumn: "ap_account_id",
    type: "liability",
    namePattern: "%payable%",
    label: "Accounts Payable",
  });
}

export function findSalesTaxPayableAccount(supabase: SupabaseClient, organizationId: string) {
  return findControlAccount(supabase, organizationId, {
    settingColumn: "tax_payable_account_id",
    type: "liability",
    namePattern: "%tax%",
    label: "Sales Tax Payable",
  });
}
