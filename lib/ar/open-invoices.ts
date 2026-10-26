import type { SupabaseClient } from "@supabase/supabase-js";

export interface OpenInvoice {
  id: string;
  invoice_number: string;
  customer_id: string;
  remaining: number;
}

interface Row {
  id: string;
  invoice_number: string;
  customer_id: string;
  tax_amount: number;
  invoice_lines: { amount: number }[];
  invoice_payments: { amount: number }[];
}

// Invoices that still owe something, with what's left.
export async function fetchOpenInvoices(supabase: SupabaseClient, orgId: string): Promise<OpenInvoice[]> {
  const { data, error } = await supabase
    .from("invoices")
    .select("id, invoice_number, customer_id, tax_amount, invoice_lines(amount), invoice_payments(amount)")
    .eq("organization_id", orgId)
    .in("status", ["open", "partial"])
    .order("invoice_date");
  if (error) throw error;
  return ((data ?? []) as Row[]).map((i) => {
    const owed = i.invoice_lines.reduce((s, l) => s + Number(l.amount), 0) + Number(i.tax_amount);
    const paid = i.invoice_payments.reduce((s, p) => s + Number(p.amount), 0);
    return { id: i.id, invoice_number: i.invoice_number, customer_id: i.customer_id, remaining: Math.round((owed - paid) * 100) / 100 };
  });
}
