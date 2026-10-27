"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/org/current";

function amount(formData: FormData, field: string): number | null {
  const value = Number.parseFloat(String(formData.get(field) ?? ""));
  return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : null;
}

function text(formData: FormData, field: string): string | null {
  return String(formData.get(field) ?? "").trim() || null;
}

function refresh(): void {
  revalidatePath("/properties");
  revalidatePath("/");
}

// RLS limits all three to writers of the current organization.
export async function createPropertyAction(formData: FormData): Promise<void> {
  const orgId = await getCurrentOrgId();
  const name = text(formData, "name");
  if (!orgId || !name) return;

  const purchasePrice = amount(formData, "purchasePrice");
  // Another asset (collectibles, jewelry) has no address.
  const other = formData.get("kind") === "other";
  const supabase = await createClient();
  const { error } = await supabase.from("properties").insert({
    organization_id: orgId,
    name,
    kind: other ? "other" : "real_estate",
    address_street: other ? null : text(formData, "street"),
    address_city: other ? null : text(formData, "city"),
    address_state: other ? null : text(formData, "state"),
    address_zip: other ? null : text(formData, "zip"),
    purchase_price: purchasePrice,
    purchase_date: text(formData, "purchaseDate"),
    estimated_value: amount(formData, "estimatedValue") ?? purchasePrice,
    last_valuation_at: new Date().toISOString(),
  });
  if (error) console.error("Couldn't add the property", error);
  refresh();
}

export async function updatePropertyValueAction(formData: FormData): Promise<void> {
  const id = text(formData, "propertyId");
  const value = amount(formData, "estimatedValue");
  if (!id || value === null) return;

  const supabase = await createClient();
  const { error } = await supabase
    .from("properties")
    .update({ estimated_value: value, last_valuation_at: new Date().toISOString() })
    .eq("id", id);
  if (error) console.error("Couldn't update the value", error);
  refresh();
}

export async function deletePropertyAction(formData: FormData): Promise<void> {
  const id = text(formData, "propertyId");
  if (!id) return;

  const supabase = await createClient();
  const { error } = await supabase.from("properties").delete().eq("id", id);
  if (error) console.error("Couldn't remove the property", error);
  refresh();
}
