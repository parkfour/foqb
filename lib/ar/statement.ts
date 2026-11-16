import type { SupabaseClient } from "@supabase/supabase-js";

// A customer statement: what they owed going into the period, each invoice
// and payment in it, and what they owe at the end. Void invoices are left
// out, with their payments. A credit memo not yet applied to an invoice is
// its own credit line on its date (an applied one is a payment on its
// invoice).

export interface StatementInvoice {
  id: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string | null;
  total: number;
  // memo: the credit memo number when the "payment" is a credit memo applied.
  payments: { payment_date: string; amount: number; memo?: string | null }[];
}

export interface StatementCredit {
  memo_number: string;
  memo_date: string;
  total: number;
}

export interface StatementLine {
  date: string;
  kind: "invoice" | "payment" | "credit";
  href: string;
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

// The customer's credit memos not yet applied to an invoice.
export async function fetchUnappliedCredits(supabase: SupabaseClient, orgId: string, customerId: string): Promise<StatementCredit[]> {
  const { data, error } = await supabase
    .from("credit_memos")
    .select("memo_number, memo_date, total, invoice_payments(id)")
    .eq("organization_id", orgId)
    .eq("customer_id", customerId);
  if (error) throw error;
  return ((data ?? []) as unknown as (StatementCredit & { invoice_payments: { id: string }[] })[])
    .filter((m) => m.invoice_payments.length === 0)
    .map((m) => ({ memo_number: m.memo_number, memo_date: m.memo_date, total: Number(m.total) }));
}

export function buildStatement(invoices: StatementInvoice[], start: string, end: string, credits: StatementCredit[] = []): Statement {
  let opening = 0;
  const activity: Omit<StatementLine, "balance">[] = [];
  for (const inv of invoices) {
    if (inv.invoice_date < start) opening += inv.total;
    else if (inv.invoice_date <= end) {
      activity.push({ date: inv.invoice_date, kind: "invoice", href: `/customers/invoices/${inv.id}`, label: `Invoice ${inv.invoice_number}`, amount: inv.total });
    }
    for (const p of inv.payments) {
      if (p.payment_date < start) opening -= p.amount;
      else if (p.payment_date <= end) {
        activity.push({ date: p.payment_date, kind: "payment", href: `/customers/invoices/${inv.id}`, label: p.memo ? `Credit memo ${p.memo}, invoice ${inv.invoice_number}` : `Payment, invoice ${inv.invoice_number}`, amount: -p.amount });
      }
    }
  }
  for (const c of credits) {
    if (c.memo_date < start) opening -= c.total;
    else if (c.memo_date <= end) {
      activity.push({ date: c.memo_date, kind: "credit", href: "/customers/credit-memos", label: `Credit memo ${c.memo_number}, not yet applied`, amount: -c.total });
    }
  }
  // Invoices before payments and credits on the same day.
  activity.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === b.kind ? 0 : a.kind === "invoice" ? -1 : 1));
  let balance = round2(opening);
  const lines = activity.map((l) => {
    balance = round2(balance + l.amount);
    return { ...l, amount: round2(l.amount), balance };
  });
  return { opening: round2(opening), lines, closing: balance };
}
