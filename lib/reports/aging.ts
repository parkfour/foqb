import { createClient } from "@/lib/supabase/server";

export type AgingBucket = "current" | "1-30" | "31-60" | "61-90" | "90+";

export interface AgingRow {
  id: string;
  number: string;
  partyName: string;
  dueDate: string;
  remaining: number;
  daysOverdue: number;
  bucket: AgingBucket;
}

export const AGING_BUCKETS: AgingBucket[] = ["current", "1-30", "31-60", "61-90", "90+"];

function bucketFor(daysOverdue: number): AgingBucket {
  if (daysOverdue <= 0) return "current";
  if (daysOverdue <= 30) return "1-30";
  if (daysOverdue <= 60) return "31-60";
  if (daysOverdue <= 90) return "61-90";
  return "90+";
}

function daysBetween(asOf: string, dueDate: string): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.round((new Date(asOf).getTime() - new Date(dueDate).getTime()) / msPerDay);
}

interface RawDocument {
  id: string;
  number: string;
  date: string;
  due_date: string | null;
  tax_amount?: number;
  party: { name: string } | null;
  lines: { amount: number }[];
  payments: { amount: number }[];
}

function toAgingRows(documents: RawDocument[], asOf: string): AgingRow[] {
  return documents
    .map((doc) => {
      const total =
        doc.lines.reduce((sum, l) => sum + Number(l.amount), 0) + Number(doc.tax_amount ?? 0);
      const paid = doc.payments.reduce((sum, p) => sum + Math.abs(Number(p.amount)), 0);
      const remaining = Math.round((total - paid) * 100) / 100;
      const dueDate = doc.due_date ?? doc.date;
      const daysOverdue = daysBetween(asOf, dueDate);

      return {
        id: doc.id,
        number: doc.number,
        partyName: doc.party?.name ?? "—",
        dueDate,
        remaining,
        daysOverdue,
        bucket: bucketFor(daysOverdue),
      };
    })
    .filter((row) => row.remaining > 0)
    .sort((a, b) => b.daysOverdue - a.daysOverdue);
}

export async function fetchArAging(orgId: string, asOf: string): Promise<AgingRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoices")
    .select(
      "id, number:invoice_number, date:invoice_date, due_date, tax_amount, party:customers(name), lines:invoice_lines(amount), payments:invoice_payments(amount)",
    )
    .eq("organization_id", orgId)
    .in("status", ["open", "partial"])
    .lte("invoice_date", asOf);

  if (error) throw error;
  return toAgingRows((data as unknown as RawDocument[]) ?? [], asOf);
}

export async function fetchApAging(orgId: string, asOf: string): Promise<AgingRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bills")
    .select(
      "id, number:bill_number, date:bill_date, due_date, party:vendors(name), lines:bill_lines(amount), payments:bill_payments(amount)",
    )
    .eq("organization_id", orgId)
    .in("status", ["open", "partial"])
    .lte("bill_date", asOf);

  if (error) throw error;
  return toAgingRows((data as unknown as RawDocument[]) ?? [], asOf);
}

export interface PartyDocumentRow {
  id: string;
  number: string;
  date: string;
  dueDate: string;
  status: "open" | "partial" | "paid" | "void";
  total: number;
  paid: number;
  remaining: number;
  daysOverdue: number;
  bucket: AgingBucket;
}

interface RawPartyDocument extends RawDocument {
  status: "open" | "partial" | "paid" | "void";
}

// Unlike toAgingRows (org-wide aging report, only outstanding balances),
// this keeps every document regardless of status/remaining — a customer or
// vendor status page shows full history, not just what's still owed. A
// void document is treated as owing nothing (it was cancelled) even though
// its lines/payments are still shown for the record.
function toPartyRows(documents: RawPartyDocument[], asOf: string): PartyDocumentRow[] {
  return documents
    .map((doc) => {
      const total =
        doc.lines.reduce((sum, l) => sum + Number(l.amount), 0) + Number(doc.tax_amount ?? 0);
      const paid = doc.payments.reduce((sum, p) => sum + Math.abs(Number(p.amount)), 0);
      const remaining = doc.status === "void" ? 0 : Math.round((total - paid) * 100) / 100;
      const dueDate = doc.due_date ?? doc.date;
      const daysOverdue = daysBetween(asOf, dueDate);

      return {
        id: doc.id,
        number: doc.number,
        date: doc.date,
        dueDate,
        status: doc.status,
        total: Math.round(total * 100) / 100,
        paid: Math.round(paid * 100) / 100,
        remaining,
        daysOverdue,
        bucket: bucketFor(daysOverdue),
      };
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

export async function fetchCustomerInvoices(
  orgId: string,
  customerId: string,
  asOf: string,
): Promise<PartyDocumentRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoices")
    .select(
      "id, number:invoice_number, date:invoice_date, due_date, status, tax_amount, party:customers(name), lines:invoice_lines(amount), payments:invoice_payments(amount)",
    )
    .eq("organization_id", orgId)
    .eq("customer_id", customerId);

  if (error) throw error;
  return toPartyRows((data as unknown as RawPartyDocument[]) ?? [], asOf);
}

export async function fetchVendorBills(
  orgId: string,
  vendorId: string,
  asOf: string,
): Promise<PartyDocumentRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bills")
    .select(
      "id, number:bill_number, date:bill_date, due_date, status, party:vendors(name), lines:bill_lines(amount), payments:bill_payments(amount)",
    )
    .eq("organization_id", orgId)
    .eq("vendor_id", vendorId);

  if (error) throw error;
  return toPartyRows((data as unknown as RawPartyDocument[]) ?? [], asOf);
}
