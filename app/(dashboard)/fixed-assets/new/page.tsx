import { redirect } from "next/navigation";
import { FixedAssetForm } from "@/components/fixed-assets/fixed-asset-form";
import { ReadOnlyNotice } from "@/components/ui/read-only-notice";
import { createClient } from "@/lib/supabase/server";
import { canWrite, getCurrentOrgId, getCurrentUserRole, getUseAccountCodes } from "@/lib/org/current";

export default async function NewFixedAssetPage() {
  const orgId = await getCurrentOrgId();

  if (!orgId) {
    redirect("/");
  }

  if (!canWrite(await getCurrentUserRole(orgId))) {
    return <ReadOnlyNotice />;
  }

  const supabase = await createClient();

  const [{ data: assetAccounts }, { data: expenseAccounts }, showAccountCodes] = await Promise.all([
    supabase
      .from("accounts")
      .select("id, account_number, name")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .eq("type", "asset")
      .order("account_number"),
    supabase
      .from("accounts")
      .select("id, account_number, name")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .eq("type", "expense")
      .order("account_number"),
    getUseAccountCodes(orgId),
  ]);

  return (
    <FixedAssetForm
      organizationId={orgId}
      assetAccounts={assetAccounts ?? []}
      expenseAccounts={expenseAccounts ?? []}
      showAccountCodes={showAccountCodes}
    />
  );
}
