"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/app/(dashboard)/actions";

export async function createInventoryItem(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const organizationId = formData.get("organizationId") as string;
  const sku = (formData.get("sku") as string)?.trim();
  const name = (formData.get("name") as string)?.trim();
  const quantityRaw = (formData.get("quantityOnHand") as string)?.trim();
  const unitCostRaw = (formData.get("unitCost") as string)?.trim();
  const assetAccountId = (formData.get("assetAccountId") as string) || null;

  if (!organizationId || !sku || !name) {
    return { error: "SKU and name are required" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("inventory_items").insert({
    organization_id: organizationId,
    sku,
    name,
    quantity_on_hand: quantityRaw ? Number(quantityRaw) : 0,
    unit_cost: unitCostRaw ? Number(unitCostRaw) : 0,
    asset_account_id: assetAccountId,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/inventory");
  return { error: null };
}

export async function adjustInventoryQuantity(formData: FormData): Promise<void> {
  const id = formData.get("id") as string;
  const quantityOnHand = formData.get("quantityOnHand") as string;
  if (!id || quantityOnHand === null) return;

  const supabase = await createClient();
  await supabase
    .from("inventory_items")
    .update({ quantity_on_hand: Number(quantityOnHand) })
    .eq("id", id);

  revalidatePath("/inventory");
}

export async function toggleInventoryItemActive(formData: FormData): Promise<void> {
  const id = formData.get("id") as string;
  const isActive = formData.get("isActive") === "true";
  if (!id) return;

  const supabase = await createClient();
  await supabase.from("inventory_items").update({ is_active: !isActive }).eq("id", id);

  revalidatePath("/inventory");
}

export async function deleteInventoryItem(formData: FormData): Promise<void> {
  const id = formData.get("id") as string;
  if (!id) return;

  const supabase = await createClient();
  await supabase.from("inventory_items").delete().eq("id", id);

  revalidatePath("/inventory");
}
