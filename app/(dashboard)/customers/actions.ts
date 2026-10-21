"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/app/(dashboard)/actions";

export async function createCustomer(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const organizationId = formData.get("organizationId") as string;
  const name = (formData.get("name") as string)?.trim();
  const email = (formData.get("email") as string)?.trim() || null;
  const phone = (formData.get("phone") as string)?.trim() || null;
  const billingAddress = (formData.get("billingAddress") as string)?.trim() || null;

  if (!organizationId || !name) {
    return { error: "Customer name is required" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("customers").insert({
    organization_id: organizationId,
    name,
    email,
    phone,
    billing_address: billingAddress,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/customers");
  redirect("/customers");
}

export async function updateCustomer(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = formData.get("id") as string;
  const name = (formData.get("name") as string)?.trim();
  const email = (formData.get("email") as string)?.trim() || null;
  const phone = (formData.get("phone") as string)?.trim() || null;
  const billingAddress = (formData.get("billingAddress") as string)?.trim() || null;

  if (!id || !name) {
    return { error: "Customer name is required" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("customers")
    .update({ name, email, phone, billing_address: billingAddress })
    .eq("id", id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/customers");
  redirect("/customers");
}

export async function toggleCustomerActive(formData: FormData): Promise<void> {
  const id = formData.get("id") as string;
  const isActive = formData.get("isActive") === "true";
  if (!id) return;

  const supabase = await createClient();
  await supabase.from("customers").update({ is_active: !isActive }).eq("id", id);

  revalidatePath("/customers");
}

export async function deleteCustomer(formData: FormData): Promise<void> {
  const id = formData.get("id") as string;
  if (!id) return;

  const supabase = await createClient();
  await supabase.from("customers").delete().eq("id", id);

  revalidatePath("/customers");
}

export async function voidInvoice(formData: FormData): Promise<void> {
  const id = formData.get("id") as string;
  if (!id) return;

  const supabase = await createClient();
  // Only a fully-open (unpaid) invoice can be voided directly — one with
  // payments applied would also need those payments' journal entries
  // reversed, which this simple guard deliberately doesn't attempt.
  const { data: invoice } = await supabase
    .from("invoices")
    .select("journal_entry_id")
    .eq("id", id)
    .eq("status", "open")
    .maybeSingle();

  if (!invoice) return;

  if (invoice.journal_entry_id) {
    await supabase
      .from("journal_entries")
      .update({ status: "void" })
      .eq("id", invoice.journal_entry_id)
      .eq("status", "posted");
  }

  await supabase.from("invoices").update({ status: "void" }).eq("id", id).eq("status", "open");

  revalidatePath("/customers/invoices");
}
