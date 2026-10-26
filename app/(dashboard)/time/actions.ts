"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/org/current";
import { createInvoice } from "@/lib/ar/create-invoice";
import { isUnbilled, timeInvoiceLines, type UnbilledEntry } from "@/lib/ar/time";

type State = { error: string | null };

export async function addTimeEntry(_prev: State, formData: FormData): Promise<State> {
  const orgId = await getCurrentOrgId();
  if (!orgId) return { error: "No book selected" };
  const value = (name: string) => ((formData.get(name) as string) ?? "").trim() || null;
  const hours = Number(formData.get("hours"));
  const workDate = value("workDate");
  const rate = value("rate");
  if (!workDate || !(hours > 0 && hours <= 24)) return { error: "A date and between 0 and 24 hours are required" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase.from("time_entries").insert({
    organization_id: orgId,
    user_id: user?.id ?? null,
    work_date: workDate,
    hours,
    customer_id: value("customerId"),
    item_id: value("itemId"),
    description: value("description"),
    billable: formData.get("billable") === "on",
    rate: rate === null ? null : Number(rate),
  });
  if (error) return { error: error.message };
  revalidatePath("/time");
  return { error: null };
}

export async function deleteTimeEntry(formData: FormData): Promise<void> {
  const id = formData.get("id") as string;
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("time_entries").delete().eq("id", id);
  revalidatePath("/time");
}

// One invoice for a customer's unbilled billable hours.
// ponytail: no claim before posting, so two people invoicing the same
// customer at once could both bill the hours; a claim column if that happens.
export async function invoiceTime(_prev: State, formData: FormData): Promise<State> {
  const orgId = await getCurrentOrgId();
  const customerId = formData.get("customerId") as string;
  const invoiceNumber = ((formData.get("invoiceNumber") as string) ?? "").trim();
  const invoiceDate = formData.get("invoiceDate") as string;
  if (!orgId || !customerId) return { error: "No customer" };
  if (!invoiceNumber || !invoiceDate) return { error: "Invoice number and date are required" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("time_entries")
    .select("id, work_date, hours, description, rate, item_id, items(name, income_account_id, sale_price), invoices(status)")
    .eq("organization_id", orgId)
    .eq("customer_id", customerId)
    .eq("billable", true)
    .order("work_date");
  if (error) return { error: error.message };

  const { lines, billed } = timeInvoiceLines(((data ?? []) as unknown as UnbilledEntry[]).filter(isUnbilled));
  if (lines.length === 0) return { error: "No unbilled hours with an item and a rate" };

  const result = await createInvoice(
    supabase,
    { organization_id: orgId, customer_id: customerId, invoice_number: invoiceNumber, invoice_date: invoiceDate, due_date: null, tax_rate: 0, lines },
    user?.id ?? null,
  );
  if ("error" in result) return { error: result.error };

  await supabase.from("time_entries").update({ invoice_id: result.id }).in("id", billed);
  revalidatePath("/time");
  revalidatePath("/customers/invoices");
  return { error: null };
}
