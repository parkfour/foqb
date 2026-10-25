"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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
  const { error } = await supabase.from("vendors").insert({
    organization_id: organizationId,
    name,
    email,
    phone,
    address,
    is_1099,
  });

  if (error) {
    return { error: error.message };
  }

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

export async function voidBill(formData: FormData): Promise<void> {
  const id = formData.get("id") as string;
  if (!id) return;

  const supabase = await createClient();
  // Only a fully-open (unpaid) bill can be voided directly — one with
  // payments applied would also need those payments' journal entries
  // reversed, which this simple guard deliberately doesn't attempt.
  const { data: bill } = await supabase
    .from("bills")
    .select("journal_entry_id")
    .eq("id", id)
    .eq("status", "open")
    .maybeSingle();

  if (!bill) return;

  if (bill.journal_entry_id) {
    await supabase
      .from("journal_entries")
      .update({ status: "void" })
      .eq("id", bill.journal_entry_id)
      .eq("status", "posted");
  }

  await supabase.from("bills").update({ status: "void" }).eq("id", id).eq("status", "open");

  revalidatePath("/vendors/bills");
}
