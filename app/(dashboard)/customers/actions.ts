"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { emitHook } from "@/lib/plugins/hooks";
import { ensureServerPluginsLoaded } from "@/lib/plugins/server-loader";
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
  const { data: created, error } = await supabase.from("customers").insert({
    organization_id: organizationId,
    name,
    email,
    phone,
    billing_address: billingAddress,
  }).select("id").single();

  if (error) {
    return { error: error.message };
  }

  ensureServerPluginsLoaded();
  await emitHook("customer:created", { customerId: created.id as string, name, email, orgId: organizationId });

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

// Voids it, with any payments on it: void_invoice reverses their entries
// and sends their bank transactions back to the feed.
export async function voidInvoice(_prev: { error: string | null }, formData: FormData): Promise<{ error: string | null }> {
  const id = formData.get("id") as string;
  if (!id) return { error: null };

  const supabase = await createClient();
  const { error } = await supabase.rpc("void_invoice", { p_invoice_id: id });
  if (error) return { error: error.message };

  const { data: voided } = await supabase.from("invoices").select("invoice_number, organization_id").eq("id", id).maybeSingle();
  if (voided) {
    ensureServerPluginsLoaded();
    await emitHook("invoice:voided", { invoiceId: id, invoiceNumber: voided.invoice_number as string, orgId: voided.organization_id as string });
  }

  revalidatePath("/customers/invoices");
  revalidatePath("/transactions");
  return { error: null };
}
