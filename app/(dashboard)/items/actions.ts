"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/app/(dashboard)/actions";

export async function createItem(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const organizationId = formData.get("organizationId") as string;
  const name = (formData.get("name") as string)?.trim();
  const description = (formData.get("description") as string)?.trim() || null;
  const incomeAccountId = formData.get("incomeAccountId") as string;
  const salePriceRaw = (formData.get("salePrice") as string)?.trim();
  const trackQuantity = formData.get("trackQuantity") === "true";
  const quantityRaw = (formData.get("quantityOnHand") as string)?.trim();

  if (!organizationId || !name || !incomeAccountId) {
    return { error: "Name and income account are required" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("items").insert({
    organization_id: organizationId,
    name,
    description,
    income_account_id: incomeAccountId,
    sale_price: salePriceRaw ? Number(salePriceRaw) : null,
    track_quantity: trackQuantity,
    quantity_on_hand: trackQuantity && quantityRaw ? Number(quantityRaw) : 0,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/items");
  redirect("/items");
}

export async function updateItem(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = formData.get("id") as string;
  const name = (formData.get("name") as string)?.trim();
  const description = (formData.get("description") as string)?.trim() || null;
  const incomeAccountId = formData.get("incomeAccountId") as string;
  const salePriceRaw = (formData.get("salePrice") as string)?.trim();
  const trackQuantity = formData.get("trackQuantity") === "true";
  const quantityRaw = (formData.get("quantityOnHand") as string)?.trim();

  if (!id || !name || !incomeAccountId) {
    return { error: "Name and income account are required" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("items")
    .update({
      name,
      description,
      income_account_id: incomeAccountId,
      sale_price: salePriceRaw ? Number(salePriceRaw) : null,
      track_quantity: trackQuantity,
      quantity_on_hand: trackQuantity && quantityRaw ? Number(quantityRaw) : 0,
    })
    .eq("id", id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/items");
  redirect("/items");
}

export async function toggleItemActive(formData: FormData): Promise<void> {
  const id = formData.get("id") as string;
  const isActive = formData.get("isActive") === "true";
  if (!id) return;

  const supabase = await createClient();
  await supabase.from("items").update({ is_active: !isActive }).eq("id", id);

  revalidatePath("/items");
}

export async function deleteItem(formData: FormData): Promise<void> {
  const id = formData.get("id") as string;
  if (!id) return;

  const supabase = await createClient();
  await supabase.from("items").delete().eq("id", id);

  revalidatePath("/items");
}
