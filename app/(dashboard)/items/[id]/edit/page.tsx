import { notFound, redirect } from "next/navigation";
import { ItemForm } from "@/components/items/item-form";
import { ReadOnlyNotice } from "@/components/ui/read-only-notice";
import { createClient } from "@/lib/supabase/server";
import { canWrite, getCurrentOrgId, getCurrentUserRole, getUseAccountCodes } from "@/lib/org/current";

export default async function EditItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const orgId = await getCurrentOrgId();

  if (!orgId) {
    redirect("/");
  }

  if (!canWrite(await getCurrentUserRole(orgId))) {
    return <ReadOnlyNotice />;
  }

  const supabase = await createClient();

  const [{ data: item }, { data: accounts }, showAccountCodes] = await Promise.all([
    supabase
      .from("items")
      .select("id, name, description, income_account_id, sale_price, track_quantity, quantity_on_hand")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("accounts")
      .select("id, account_number, name")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .eq("type", "revenue")
      .order("account_number"),
    getUseAccountCodes(orgId),
  ]);

  if (!item) {
    notFound();
  }

  return (
    <ItemForm
      organizationId={orgId}
      accounts={accounts ?? []}
      item={item}
      showAccountCodes={showAccountCodes}
    />
  );
}
