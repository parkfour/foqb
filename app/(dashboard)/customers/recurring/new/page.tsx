import { redirect } from "next/navigation";
import { RecurringInvoiceForm } from "@/components/customers/recurring-invoice-form";
import { ReadOnlyNotice } from "@/components/ui/read-only-notice";
import { createClient } from "@/lib/supabase/server";
import { canWrite, getCurrentOrgId, getCurrentUserRole, getUseAccountCodes } from "@/lib/org/current";

export default async function NewRecurringInvoicePage() {
  const orgId = await getCurrentOrgId();

  if (!orgId) {
    redirect("/");
  }

  if (!canWrite(await getCurrentUserRole(orgId))) {
    return <ReadOnlyNotice />;
  }

  const supabase = await createClient();

  const [{ data: customers }, { data: accounts }, { data: items }, showAccountCodes] = await Promise.all([
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
    getUseAccountCodes(orgId),
  ]);

  return (
    <RecurringInvoiceForm
      organizationId={orgId}
      customers={customers ?? []}
      accounts={accounts ?? []}
      items={items ?? []}
      showAccountCodes={showAccountCodes}
    />
  );
}
