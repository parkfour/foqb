// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHmac, timingSafeEqual } from "node:crypto";

// The few Stripe API calls the plugin makes, over plain fetch (no SDK).
// Server-only: these take the book's secret key.

const API = "https://api.stripe.com/v1";
// Stripe's signed webhooks older than this are refused (replays).
const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

// Currencies Stripe counts in whole units rather than hundredths.
const ZERO_DECIMAL = new Set(["bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf"]);

export function toMinorUnits(amount: number, currency: string): number {
  return ZERO_DECIMAL.has(currency.toLowerCase()) ? Math.round(amount) : Math.round(amount * 100);
}

export function fromMinorUnits(amount: number, currency: string): number {
  return ZERO_DECIMAL.has(currency.toLowerCase()) ? amount : amount / 100;
}

export function isStripeSecretKey(key: string): boolean {
  return /^(sk|rk)_(live|test)_[A-Za-z0-9]{10,}$/.test(key);
}

async function call<T>(secretKey: string, path: string, params: Record<string, string>): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${secretKey}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(`Stripe: ${json.error?.message ?? res.status}`);
  return json;
}

// A payment link for one amount, which Stripe keeps until it's turned off
// (unlike a Checkout session, which lapses in a day).
export async function createPaymentLink(
  secretKey: string,
  { name, amount, currency, invoiceId }: { name: string; amount: number; currency: string; invoiceId: string },
): Promise<{ id: string; url: string }> {
  const price = await call<{ id: string }>(secretKey, "/prices", {
    currency: currency.toLowerCase(),
    unit_amount: String(toMinorUnits(amount, currency)),
    "product_data[name]": name,
  });
  return call<{ id: string; url: string }>(secretKey, "/payment_links", {
    "line_items[0][price]": price.id,
    "line_items[0][quantity]": "1",
    "metadata[foqb_invoice_id]": invoiceId,
    // One payment per link: Stripe turns it off once paid.
    "restrictions[completed_sessions][limit]": "1",
  });
}

export async function deactivatePaymentLink(secretKey: string, id: string): Promise<void> {
  await call(secretKey, `/payment_links/${encodeURIComponent(id)}`, { active: "false" });
}

// Checks a Stripe-Signature header ("t=…,v1=…") against the raw body.
export function verifyStripeSignature(body: string, header: string | null, secret: string, now = Date.now()): boolean {
  if (!header) return false;
  const parts = header.split(",").map((p) => p.split("="));
  const timestamp = Number(parts.find(([k]) => k === "t")?.[1]);
  if (!Number.isFinite(timestamp) || Math.abs(now / 1000 - timestamp) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest();
  return parts
    .filter(([k]) => k === "v1")
    .some(([, sig]) => {
      const given = Buffer.from(sig ?? "", "hex");
      return given.length === expected.length && timingSafeEqual(given, expected);
    });
}
