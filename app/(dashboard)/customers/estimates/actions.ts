"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/org/current";
import { createInvoice } from "@/lib/ar/create-invoice";
import { emitHook } from "@/lib/plugins/hooks";
import { ensureServerPluginsLoaded } from "@/lib/plugins/server-loader";

type EstimateStatus = "open" | "accepted" | "declined";

// Accept, decline, or reopen an estimate that hasn't been invoiced.
export async function setEstimateStatus(formData: FormData): Promise<void> {
  const id = formData.get("id") as string;
  const status = formData.get("status") as EstimateStatus;
  const orgId = await getCurrentOrgId();
  if (!id || !orgId || !["open", "accepted", "declined"].includes(status)) return;

  const supabase = await createClient();
  const { data: changed } = await supabase
    .from("estimates")
    .update({ status })
    .eq("id", id)
    .eq("organization_id", orgId)
    .neq("status", "invoiced")
    .neq("status", status)
    .select("estimate_number");
  const estimateNumber = (changed as { estimate_number: string }[] | null)?.[0]?.estimate_number;
  if (estimateNumber) {
    ensureServerPluginsLoaded();
    await emitHook("estimate:status_changed", { estimateId: id, estimateNumber, status, invoiceId: null, orgId });
  }
  revalidatePath(`/customers/estimates/${id}`);
  revalidatePath("/customers/estimates");
}

interface EstimateRow {
  customer_id: string;
  estimate_number: string;
  status: string;
  tax_rate: number;
  tax_rate_ids: string[];
  estimate_lines: { item_id: string | null; account_id: string; description: string | null; quantity: number; unit_price: number }[];
}

// Turns an estimate into an invoice dated today (the book's today, given
// by the form): same lines, same named tax rates. The estimate is marked
// invoiced first, so pressing twice can't make two invoices; it goes back
// if the invoice fails.
export async function convertEstimateToInvoice(
  _prev: { error: string | null },
  formData: FormData,
): Promise<{ error: string | null }> {
  const id = formData.get("id") as string;
  const invoiceNumber = (formData.get("invoiceNumber") as string)?.trim();
  const invoiceDate = formData.get("invoiceDate") as string;
  const dueDate = (formData.get("dueDate") as string) || null;
  const orgId = await getCurrentOrgId();
  if (!id || !orgId) return { error: "No estimate" };
  if (!invoiceNumber || !invoiceDate) return { error: "Invoice number and date are required" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in again" };

  const { data } = await supabase
    .from("estimates")
    .select("customer_id, estimate_number, status, tax_rate, tax_rate_ids, estimate_lines(item_id, account_id, description, quantity, unit_price)")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();
  const estimate = data as EstimateRow | null;
  if (!estimate) return { error: "Estimate not found" };
  if (estimate.status === "invoiced") return { error: "This estimate has already been invoiced" };

  const { data: claimed } = await supabase
    .from("estimates")
    .update({ status: "invoiced" })
    .eq("id", id)
    .eq("status", estimate.status)
    .select("id");
  if (!claimed?.length) return { error: "This estimate was just changed; reload and try again" };

  const result = await createInvoice(
    supabase,
    {
      organization_id: orgId,
      customer_id: estimate.customer_id,
      invoice_number: invoiceNumber,
      invoice_date: invoiceDate,
      due_date: dueDate,
      tax_rate: Number(estimate.tax_rate),
      ...(estimate.tax_rate_ids.length > 0 ? { tax_rate_ids: estimate.tax_rate_ids } : {}),
      lines: estimate.estimate_lines.map((l) => ({ ...l, description: l.description ?? "" })),
    },
    user.id,
  );

  if ("error" in result) {
    await supabase.from("estimates").update({ status: estimate.status }).eq("id", id);
    return { error: result.error };
  }

  await supabase.from("estimates").update({ invoice_id: result.id }).eq("id", id);
  ensureServerPluginsLoaded();
  await emitHook("estimate:status_changed", {
    estimateId: id,
    estimateNumber: estimate.estimate_number,
    status: "invoiced",
    invoiceId: result.id,
    orgId,
  });
  revalidatePath("/customers/estimates");
  revalidatePath("/customers/invoices");
  redirect(`/customers/invoices/${result.id}`);
}
