import { createClient } from "@/lib/supabase/server";

// What a business paid each vendor marked for a 1099-NEC, by payment date
// (1099s are cash basis). Payments made from a credit card account are
// left out: the card company reports those on a 1099-K.
// ponytail: only payments recorded against bills count; a contractor paid
// straight from the bank feed, without a bill, isn't in it yet.

export interface Vendor1099Row {
  vendorId: string;
  name: string;
  address: string | null;
  paid: number;
  byCard: number;
  meetsThreshold: boolean;
}

// The amount from which a 1099-NEC is required: $600 through 2025, $2,000
// for payments from 2026 on (One Big Beautiful Bill Act).
export function nec1099Threshold(year: number): number {
  return year >= 2026 ? 2000 : 600;
}

interface PaymentRow {
  amount: number | string;
  payment_date: string;
  accounts: { type: string } | null;
  bills: { vendor_id: string; status: string } | null;
}

export function summarize1099(
  vendors: { id: string; name: string; address: string | null }[],
  payments: PaymentRow[],
  year: number,
): Vendor1099Row[] {
  const threshold = nec1099Threshold(year);
  return vendors
    .map((v) => {
      let paid = 0;
      let byCard = 0;
      for (const p of payments) {
        if (p.bills?.vendor_id !== v.id || p.bills.status === "void") continue;
        if (p.accounts?.type === "liability") byCard += Number(p.amount);
        else paid += Number(p.amount);
      }
      paid = Math.round(paid * 100) / 100;
      return { vendorId: v.id, name: v.name, address: v.address, paid, byCard: Math.round(byCard * 100) / 100, meetsThreshold: paid >= threshold };
    })
    .sort((a, b) => b.paid - a.paid || a.name.localeCompare(b.name));
}

export async function fetch1099(orgId: string, year: number): Promise<Vendor1099Row[]> {
  const supabase = await createClient();
  const { data: vendors, error } = await supabase
    .from("vendors")
    .select("id, name, address")
    .eq("organization_id", orgId)
    .eq("is_1099", true);
  if (error) throw error;
  if (!vendors?.length) return [];

  const { data: payments, error: payError } = await supabase
    .from("bill_payments")
    .select("amount, payment_date, accounts(type), bills!inner(vendor_id, status)")
    .eq("organization_id", orgId)
    .gte("payment_date", `${year}-01-01`)
    .lte("payment_date", `${year}-12-31`)
    .in(
      "bills.vendor_id",
      vendors.map((v) => v.id),
    );
  if (payError) throw payError;
  return summarize1099(vendors as { id: string; name: string; address: string | null }[], (payments ?? []) as unknown as PaymentRow[], year);
}
