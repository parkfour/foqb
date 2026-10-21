import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { POST as postInvoice } from "@/app/api/invoices/route";
import { POST as postBill } from "@/app/api/bills/route";

export type RecurrenceFrequency = "weekly" | "monthly" | "yearly";

// Reuses the real invoice/bill posting route handlers in-process (same
// balance verification, control-account lookup, and draft->posted/rollback
// behavior as a manually created invoice) instead of duplicating that
// logic — this is just a different caller of the same endpoint, invoked
// directly rather than over HTTP since it already runs server-side.
function buildRequest(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

export function computeNextDate(current: string, frequency: RecurrenceFrequency): string {
  const date = new Date(`${current}T00:00:00Z`);
  if (frequency === "weekly") date.setUTCDate(date.getUTCDate() + 7);
  else if (frequency === "monthly") date.setUTCMonth(date.getUTCMonth() + 1);
  else date.setUTCFullYear(date.getUTCFullYear() + 1);
  return date.toISOString().slice(0, 10);
}

interface RecurringInvoiceRow {
  id: string;
  organization_id: string;
  customer_id: string;
  next_date: string;
  tax_rate: number;
  frequency: RecurrenceFrequency;
}

interface RecurringInvoiceLineRow {
  item_id: string | null;
  account_id: string;
  description: string | null;
  quantity: number;
  unit_price: number;
}

export async function generateInvoiceFromTemplate(
  orgId: string,
  recurringInvoiceId: string,
): Promise<{ id: string } | { error: string }> {
  const supabase = await createClient();

  const [{ data: template }, { data: lines }] = await Promise.all([
    supabase
      .from("recurring_invoices")
      .select("id, organization_id, customer_id, next_date, tax_rate, frequency")
      .eq("id", recurringInvoiceId)
      .eq("organization_id", orgId)
      .maybeSingle(),
    supabase
      .from("recurring_invoice_lines")
      .select("item_id, account_id, description, quantity, unit_price")
      .eq("recurring_invoice_id", recurringInvoiceId),
  ]);

  if (!template) return { error: "Recurring invoice template not found" };

  const row = template as RecurringInvoiceRow;
  const templateLines = (lines as RecurringInvoiceLineRow[] | null) ?? [];

  const response = await postInvoice(
    buildRequest("/api/invoices", {
      organization_id: row.organization_id,
      customer_id: row.customer_id,
      invoice_number: `AUTO-${row.next_date.replace(/-/g, "")}-${randomUUID().slice(0, 4)}`,
      invoice_date: row.next_date,
      due_date: null,
      tax_rate: Number(row.tax_rate),
      lines: templateLines,
    }),
  );

  const json = (await response.json()) as { id?: string; error?: string };
  if (!response.ok || !json.id) {
    return { error: json.error ?? "Failed to generate invoice" };
  }

  await supabase
    .from("recurring_invoices")
    .update({ next_date: computeNextDate(row.next_date, row.frequency) })
    .eq("id", recurringInvoiceId);

  return { id: json.id };
}

interface RecurringBillRow {
  id: string;
  organization_id: string;
  vendor_id: string;
  next_date: string;
  frequency: RecurrenceFrequency;
}

interface RecurringBillLineRow {
  account_id: string;
  description: string | null;
  quantity: number;
  unit_price: number;
}

export async function generateBillFromTemplate(
  orgId: string,
  recurringBillId: string,
): Promise<{ id: string } | { error: string }> {
  const supabase = await createClient();

  const [{ data: template }, { data: lines }] = await Promise.all([
    supabase
      .from("recurring_bills")
      .select("id, organization_id, vendor_id, next_date, frequency")
      .eq("id", recurringBillId)
      .eq("organization_id", orgId)
      .maybeSingle(),
    supabase
      .from("recurring_bill_lines")
      .select("account_id, description, quantity, unit_price")
      .eq("recurring_bill_id", recurringBillId),
  ]);

  if (!template) return { error: "Recurring bill template not found" };

  const row = template as RecurringBillRow;
  const templateLines = (lines as RecurringBillLineRow[] | null) ?? [];

  const response = await postBill(
    buildRequest("/api/bills", {
      organization_id: row.organization_id,
      vendor_id: row.vendor_id,
      bill_number: `AUTO-${row.next_date.replace(/-/g, "")}-${randomUUID().slice(0, 4)}`,
      bill_date: row.next_date,
      due_date: null,
      lines: templateLines,
    }),
  );

  const json = (await response.json()) as { id?: string; error?: string };
  if (!response.ok || !json.id) {
    return { error: json.error ?? "Failed to generate bill" };
  }

  await supabase
    .from("recurring_bills")
    .update({ next_date: computeNextDate(row.next_date, row.frequency) })
    .eq("id", recurringBillId);

  return { id: json.id };
}
