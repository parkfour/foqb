// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// A VAT period's figures: each rate's net sales and VAT charged (from the
// taxes on invoices), sales to reverse-charge customers (no VAT charged),
// other sales with no VAT, VAT paid on purchases (the input VAT account),
// and what's due.

export interface SummaryInvoice {
  id: string;
  customer_id: string;
  subtotal: number;
  taxes: { name: string; rate: number; amount: number }[];
}

export interface VatSummary {
  byRate: { name: string; rate: number; net: number; vat: number }[];
  reverseCharge: number;
  noVat: number;
  outputVat: number;
  inputVat: number;
  due: number;
}

const cents = (n: number) => Math.round(n * 100) / 100;

export function vatSummary(invoices: SummaryInvoice[], reverseChargeCustomers: Set<string>, inputVat: number): VatSummary {
  const rates = new Map<string, { name: string; rate: number; net: number; vat: number }>();
  let reverseCharge = 0;
  let noVat = 0;
  for (const inv of invoices) {
    if (inv.taxes.length === 0) {
      if (reverseChargeCustomers.has(inv.customer_id)) reverseCharge += inv.subtotal;
      else noVat += inv.subtotal;
      continue;
    }
    for (const t of inv.taxes) {
      const key = `${t.name}|${t.rate}`;
      const row = rates.get(key) ?? { name: t.name, rate: Number(t.rate), net: 0, vat: 0 };
      // Each rate is charged on the whole subtotal.
      row.net += inv.subtotal;
      row.vat += Number(t.amount);
      rates.set(key, row);
    }
  }
  const byRate = [...rates.values()].map((r) => ({ ...r, net: cents(r.net), vat: cents(r.vat) })).sort((a, b) => b.rate - a.rate);
  const outputVat = cents(byRate.reduce((s, r) => s + r.vat, 0));
  return { byRate, reverseCharge: cents(reverseCharge), noVat: cents(noVat), outputVat, inputVat: cents(inputVat), due: cents(outputVat - inputVat) };
}
