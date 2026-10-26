import { notFound, redirect } from "next/navigation";
import { ItemForm } from "@/components/items/item-form";
import { ReadOnlyNotice } from "@/components/ui/read-only-notice";
import { createClient } from "@/lib/supabase/server";
import { byType } from "@/lib/accounts/by-type";
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

  const [{ data: item }, { data: stock }, { data: accounts }, showAccountCodes] = await Promise.all([
    supabase
      .from("items")
      .select("id, name, description, income_account_id, sale_price, track_quantity, quantity_on_hand, inventory_account_id, cogs_account_id, unit_cost")
      .eq("id", id)
      .eq("organization_id", orgId)
      .maybeSingle(),
    supabase.from("item_stock").select("on_hand").eq("item_id", id).maybeSingle(),
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

  if (!item) {
    notFound();
  }

  const all = accounts ?? [];
  return (
    <ItemForm
      organizationId={orgId}
      accounts={byType(all, "revenue")}
      assetAccounts={byType(all, "asset")}
      expenseAccounts={byType(all, "expense")}
      item={{ ...item, on_hand: Number((stock as { on_hand: number } | null)?.on_hand ?? item.quantity_on_hand), unit_cost: Number(item.unit_cost) }}
      showAccountCodes={showAccountCodes}
    />
  );
}
