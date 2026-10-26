"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { emitHook } from "@/lib/plugins/hooks";
import { ensureServerPluginsLoaded } from "@/lib/plugins/server-loader";
import type { ActionState } from "@/app/(dashboard)/actions";

export async function createVendor(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const organizationId = formData.get("organizationId") as string;
  const name = (formData.get("name") as string)?.trim();
  const email = (formData.get("email") as string)?.trim() || null;
  const phone = (formData.get("phone") as string)?.trim() || null;
  const address = (formData.get("address") as string)?.trim() || null;
  const is_1099 = formData.get("is1099") === "on";

  if (!organizationId || !name) {
    return { error: "Vendor name is required" };
  }

  const supabase = await createClient();
  const { data: created, error } = await supabase.from("vendors").insert({
    organization_id: organizationId,
    name,
    email,
    phone,
    address,
    is_1099,
  }).select("id").single();

  if (error) {
    return { error: error.message };
  }

  ensureServerPluginsLoaded();
  await emitHook("vendor:created", { vendorId: created.id as string, name, email, orgId: organizationId });

  revalidatePath("/vendors");
  redirect("/vendors");
}

export async function updateVendor(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = formData.get("id") as string;
  const name = (formData.get("name") as string)?.trim();
  const email = (formData.get("email") as string)?.trim() || null;
  const phone = (formData.get("phone") as string)?.trim() || null;
  const address = (formData.get("address") as string)?.trim() || null;
  const is_1099 = formData.get("is1099") === "on";

  if (!id || !name) {
    return { error: "Vendor name is required" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("vendors")
    .update({ name, email, phone, address, is_1099 })
    .eq("id", id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/vendors");
  redirect("/vendors");
}

export async function toggleVendorActive(formData: FormData): Promise<void> {
  const id = formData.get("id") as string;
  const isActive = formData.get("isActive") === "true";
  if (!id) return;

  const supabase = await createClient();
  await supabase.from("vendors").update({ is_active: !isActive }).eq("id", id);

  revalidatePath("/vendors");
}

export async function deleteVendor(formData: FormData): Promise<void> {
  const id = formData.get("id") as string;
  if (!id) return;

  const supabase = await createClient();
  await supabase.from("vendors").delete().eq("id", id);

  revalidatePath("/vendors");
}

// Voids it, with any payments on it: void_bill reverses their entries
// and sends their bank transactions back to the feed.
export async function voidBill(_prev: { error: string | null }, formData: FormData): Promise<{ error: string | null }> {
  const id = formData.get("id") as string;
  if (!id) return { error: null };

  const supabase = await createClient();
  const { error } = await supabase.rpc("void_bill", { p_bill_id: id });
  if (error) return { error: error.message };

  const { data: voided } = await supabase.from("bills").select("bill_number, organization_id").eq("id", id).maybeSingle();
  if (voided) {
    ensureServerPluginsLoaded();
    await emitHook("bill:voided", { billId: id, billNumber: voided.bill_number as string, orgId: voided.organization_id as string });
  }

  revalidatePath("/vendors/bills");
  revalidatePath("/transactions");
  return { error: null };
}
