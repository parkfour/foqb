import { redirect } from "next/navigation";
import { ItemForm } from "@/components/items/item-form";
import { ReadOnlyNotice } from "@/components/ui/read-only-notice";
import { createClient } from "@/lib/supabase/server";
import { canWrite, getCurrentOrgId, getCurrentUserRole, getUseAccountCodes } from "@/lib/org/current";

export default async function NewItemPage() {
  const orgId = await getCurrentOrgId();

  if (!orgId) {
    redirect("/");
  }

  if (!canWrite(await getCurrentUserRole(orgId))) {
    return <ReadOnlyNotice />;
  }

  const supabase = await createClient();
  const [{ data: accounts }, showAccountCodes] = await Promise.all([
    supabase
      .from("accounts")
      .select("id, account_number, name")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .eq("type", "revenue")
      .order("account_number"),
    getUseAccountCodes(orgId),
  ]);

  return <ItemForm organizationId={orgId} accounts={accounts ?? []} showAccountCodes={showAccountCodes} />;
}
