"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { generateBillFromTemplate, type RecurrenceFrequency } from "@/lib/recurring/generate";

interface CreateRecurringBillInput {
  organizationId: string;
  vendorId: string;
  frequency: RecurrenceFrequency;
  nextDate: string;
  lines: {
    accountId: string;
    description: string;
    quantity: number;
    unitPrice: number;
  }[];
}

export async function createRecurringBill(
  input: CreateRecurringBillInput,
): Promise<{ error: string | null }> {
  if (!input.vendorId || !input.nextDate || input.lines.length === 0) {
    return { error: "Vendor, next date, and at least one line are required" };
  }

  const supabase = await createClient();
  const id = randomUUID();

  const { error: templateError } = await supabase.from("recurring_bills").insert({
    id,
    organization_id: input.organizationId,
    vendor_id: input.vendorId,
    frequency: input.frequency,
    next_date: input.nextDate,
  });

  if (templateError) return { error: templateError.message };

  const { error: linesError } = await supabase.from("recurring_bill_lines").insert(
    input.lines.map((line) => ({
      recurring_bill_id: id,
      account_id: line.accountId,
      description: line.description,
      quantity: line.quantity,
      unit_price: line.unitPrice,
    })),
  );

  if (linesError) {
    await supabase.from("recurring_bills").delete().eq("id", id);
    return { error: linesError.message };
  }

  redirect("/vendors/recurring");
}

export async function generateBillNow(formData: FormData): Promise<void> {
  const id = formData.get("id") as string;
  const organizationId = formData.get("organizationId") as string;
  if (!id || !organizationId) return;

  await generateBillFromTemplate(organizationId, id);
  revalidatePath("/vendors/recurring");
  revalidatePath("/vendors/bills");
}

export async function toggleRecurringBillActive(formData: FormData): Promise<void> {
  const id = formData.get("id") as string;
  const isActive = formData.get("isActive") === "true";
  if (!id) return;

  const supabase = await createClient();
  await supabase.from("recurring_bills").update({ is_active: !isActive }).eq("id", id);
  revalidatePath("/vendors/recurring");
}

export async function deleteRecurringBill(formData: FormData): Promise<void> {
  const id = formData.get("id") as string;
  if (!id) return;

  const supabase = await createClient();
  await supabase.from("recurring_bills").delete().eq("id", id);
  revalidatePath("/vendors/recurring");
}
