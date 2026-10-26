import { redirect } from "next/navigation";
import { InvoiceForm } from "@/components/customers/invoice-form";
import { ReadOnlyNotice } from "@/components/ui/read-only-notice";
import { createClient } from "@/lib/supabase/server";
import { fetchActiveClasses } from "@/lib/org/classes";
import { canWrite, getCurrentOrgId, getCurrentUserRole, getUseAccountCodes } from "@/lib/org/current";

export default async function NewInvoicePage() {
  const orgId = await getCurrentOrgId();

  if (!orgId) {
    redirect("/");
  }

  if (!canWrite(await getCurrentUserRole(orgId))) {
    return <ReadOnlyNotice />;
  }

  const supabase = await createClient();
  const classes = await fetchActiveClasses(supabase, orgId);

  const [{ data: customers }, { data: accounts }, { data: items }, { data: org }, { data: taxRates }, showAccountCodes] =
    await Promise.all([
      supabase
        .from("customers")
        .select("id, name")
        .eq("organization_id", orgId)
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("accounts")
        .select("id, account_number, name")
        .eq("organization_id", orgId)
        .eq("is_active", true)
        .eq("type", "revenue")
        .order("account_number"),
      supabase
        .from("items")
        .select("id, name, income_account_id, sale_price")
        .eq("organization_id", orgId)
        .eq("is_active", true)
        .order("name"),
      supabase.from("organizations").select("default_tax_rate").eq("id", orgId).maybeSingle(),
      supabase
        .from("sales_tax_rates")
        .select("id, name, rate, account_id")
        .eq("organization_id", orgId)
        .eq("is_active", true)
        .order("name"),
      getUseAccountCodes(orgId),
    ]);

  return (
    <InvoiceForm
      organizationId={orgId}
      customers={customers ?? []}
      accounts={accounts ?? []}
      items={items ?? []}
      defaultTaxRate={(org as { default_tax_rate: number | null } | null)?.default_tax_rate ?? 0}
      taxRates={taxRates ?? []}
      showAccountCodes={showAccountCodes}
      classes={classes}
    />
  );
}
