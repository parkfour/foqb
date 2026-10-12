"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { generateInvoiceFromTemplate, type RecurrenceFrequency } from "@/lib/recurring/generate";

interface CreateRecurringInvoiceInput {
  organizationId: string;
  customerId: string;
  frequency: RecurrenceFrequency;
  nextDate: string;
  taxRate: number;
  lines: {
    itemId: string | null;
    accountId: string;
    description: string;
    quantity: number;
    unitPrice: number;
  }[];
}

export async function createRecurringInvoice(
  input: CreateRecurringInvoiceInput,
): Promise<{ error: string | null }> {
  if (!input.customerId || !input.nextDate || input.lines.length === 0) {
    return { error: "Customer, next date, and at least one line are required" };
  }

  const supabase = await createClient();
  const id = randomUUID();

  const { error: templateError } = await supabase.from("recurring_invoices").insert({
    id,
    organization_id: input.organizationId,
    customer_id: input.customerId,
    frequency: input.frequency,
    next_date: input.nextDate,
    tax_rate: input.taxRate,
  });

  if (templateError) return { error: templateError.message };

  const { error: linesError } = await supabase.from("recurring_invoice_lines").insert(
    input.lines.map((line) => ({
      recurring_invoice_id: id,
      item_id: line.itemId,
      account_id: line.accountId,
      description: line.description,
      quantity: line.quantity,
      unit_price: line.unitPrice,
    })),
  );

  if (linesError) {
    await supabase.from("recurring_invoices").delete().eq("id", id);
    return { error: linesError.message };
  }

  redirect("/customers/recurring");
}

export async function generateInvoiceNow(formData: FormData): Promise<void> {
  const id = formData.get("id") as string;
  const organizationId = formData.get("organizationId") as string;
  if (!id || !organizationId) return;

  await generateInvoiceFromTemplate(organizationId, id);
  revalidatePath("/customers/recurring");
  revalidatePath("/customers/invoices");
}

export async function toggleRecurringInvoiceActive(formData: FormData): Promise<void> {
  const id = formData.get("id") as string;
  const isActive = formData.get("isActive") === "true";
  if (!id) return;

  const supabase = await createClient();
  await supabase.from("recurring_invoices").update({ is_active: !isActive }).eq("id", id);
  revalidatePath("/customers/recurring");
}

export async function deleteRecurringInvoice(formData: FormData): Promise<void> {
  const id = formData.get("id") as string;
  if (!id) return;

  const supabase = await createClient();
  await supabase.from("recurring_invoices").delete().eq("id", id);
  revalidatePath("/customers/recurring");
}
