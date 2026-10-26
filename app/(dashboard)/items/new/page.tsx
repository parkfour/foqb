import { redirect } from "next/navigation";
import { ItemForm } from "@/components/items/item-form";
import { ReadOnlyNotice } from "@/components/ui/read-only-notice";
import { createClient } from "@/lib/supabase/server";
import { byType } from "@/lib/accounts/by-type";
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
      .select("id, account_number, name, type")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .is("currency", null)
      .in("type", ["revenue", "asset", "expense"])
      .order("account_number"),
    getUseAccountCodes(orgId),
  ]);

  const all = accounts ?? [];
  return (
    <ItemForm
      organizationId={orgId}
      accounts={byType(all, "revenue")}
      assetAccounts={byType(all, "asset")}
      expenseAccounts={byType(all, "expense")}
      showAccountCodes={showAccountCodes}
    />
  );
}
