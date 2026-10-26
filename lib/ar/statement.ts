import type { SupabaseClient } from "@supabase/supabase-js";

// A customer statement: what they owed going into the period, each invoice
// and payment in it, and what they owe at the end. Void invoices are left
// out, with their payments.

export interface StatementInvoice {
  id: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string | null;
  total: number;
  // memo: the credit memo number when the "payment" is a credit memo applied.
  payments: { payment_date: string; amount: number; memo?: string | null }[];
}

export interface StatementLine {
  date: string;
  kind: "invoice" | "payment";
  invoiceId: string;
  label: string;
  amount: number;
  balance: number;
}

export interface Statement {
  opening: number;
  lines: StatementLine[];
  closing: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

interface RawInvoice {
  id: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string | null;
  tax_amount: number;
  invoice_lines: { amount: number }[];
  invoice_payments: { payment_date: string; amount: number; credit_memos: { memo_number: string } | null }[];
}

// The customer's invoices that aren't void, with their payments.
export async function fetchStatementInvoices(supabase: SupabaseClient, orgId: string, customerId: string): Promise<StatementInvoice[]> {
  const { data, error } = await supabase
    .from("invoices")
    .select("id, invoice_number, invoice_date, due_date, tax_amount, invoice_lines(amount), invoice_payments(payment_date, amount, credit_memos(memo_number))")
    .eq("organization_id", orgId)
    .eq("customer_id", customerId)
    .neq("status", "void")
    .order("invoice_date");
  if (error) throw error;
  return ((data ?? []) as unknown as RawInvoice[]).map((i) => ({
    id: i.id,
    invoice_number: i.invoice_number,
    invoice_date: i.invoice_date,
    due_date: i.due_date,
    total: i.invoice_lines.reduce((s, l) => s + Number(l.amount), 0) + Number(i.tax_amount),
    payments: i.invoice_payments.map((p) => ({ payment_date: p.payment_date, amount: Number(p.amount), memo: p.credit_memos?.memo_number })),
  }));
}

export function buildStatement(invoices: StatementInvoice[], start: string, end: string): Statement {
  let opening = 0;
  const activity: Omit<StatementLine, "balance">[] = [];
  for (const inv of invoices) {
    if (inv.invoice_date < start) opening += inv.total;
    else if (inv.invoice_date <= end) {
      activity.push({ date: inv.invoice_date, kind: "invoice", invoiceId: inv.id, label: `Invoice ${inv.invoice_number}`, amount: inv.total });
    }
    for (const p of inv.payments) {
      if (p.payment_date < start) opening -= p.amount;
      else if (p.payment_date <= end) {
        activity.push({ date: p.payment_date, kind: "payment", invoiceId: inv.id, label: p.memo ? `Credit memo ${p.memo}, invoice ${inv.invoice_number}` : `Payment, invoice ${inv.invoice_number}`, amount: -p.amount });
      }
    }
  }
  // Invoices before payments on the same day.
  activity.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === b.kind ? 0 : a.kind === "invoice" ? -1 : 1));
  let balance = round2(opening);
  const lines = activity.map((l) => {
    balance = round2(balance + l.amount);
    return { ...l, amount: round2(l.amount), balance };
  });
  return { opening: round2(opening), lines, closing: balance };
}
