import { redirect } from "next/navigation";
import { RecurringBillForm } from "@/components/vendors/recurring-bill-form";
import { ReadOnlyNotice } from "@/components/ui/read-only-notice";
import { createClient } from "@/lib/supabase/server";
import { canWrite, getCurrentOrgId, getCurrentUserRole, getUseAccountCodes } from "@/lib/org/current";

export default async function NewRecurringBillPage() {
  const orgId = await getCurrentOrgId();

  if (!orgId) {
    redirect("/");
  }

  if (!canWrite(await getCurrentUserRole(orgId))) {
    return <ReadOnlyNotice />;
  }

  const supabase = await createClient();

  const [{ data: vendors }, { data: accounts }, showAccountCodes] = await Promise.all([
    supabase
      .from("vendors")
      .select("id, name")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("accounts")
      .select("id, account_number, name")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .is("currency", null)
      .in("type", ["expense", "asset"])
      .order("account_number"),
    getUseAccountCodes(orgId),
  ]);

  return (
    <RecurringBillForm
      organizationId={orgId}
      vendors={vendors ?? []}
      accounts={accounts ?? []}
      showAccountCodes={showAccountCodes}
    />
  );
}
