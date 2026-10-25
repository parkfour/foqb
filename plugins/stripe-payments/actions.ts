// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canWrite, getCurrentUserRole } from "@/lib/org/current";
import { decryptToken, encryptToken } from "@/lib/crypto/token-encryption";
import { getBookCurrency } from "@/lib/org/book-currency";
import { createPaymentLink, deactivatePaymentLink, isStripeSecretKey } from "./stripe";

export type ActionResult = { error: string } | { ok: true; message?: string };

export interface StripeSetup {
  isOwner: boolean;
  configured: boolean;
  hasWebhookSecret: boolean;
  depositAccountId: string | null;
  depositAccounts: { id: string; name: string }[];
  webhookUrl: string;
}

// What the Settings section shows. The keys never leave the server.
export async function getStripeSetup(organizationId: string): Promise<StripeSetup | null> {
  const role = await getCurrentUserRole(organizationId);
  if (!role) return null;
  const supabase = await createClient();
  const [{ data: row }, { data: accounts }, h] = await Promise.all([
    createAdminClient()
      .from("organization_stripe_settings")
      .select("deposit_account_id, webhook_secret")
      .eq("organization_id", organizationId)
      .maybeSingle(),
    supabase
      .from("accounts")
      .select("id, name")
      .eq("organization_id", organizationId)
      .eq("type", "asset")
      .eq("is_active", true)
      .order("name"),
    headers(),
  ]);
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "your-foqb-address";
  const proto = h.get("x-forwarded-proto") ?? "https";
  return {
    isOwner: role === "owner",
    configured: !!row,
    hasWebhookSecret: !!row?.webhook_secret,
    depositAccountId: (row?.deposit_account_id as string | undefined) ?? null,
    depositAccounts: (accounts as { id: string; name: string }[] | null) ?? [],
    webhookUrl: `${proto}://${host}/api/stripe/webhook/${organizationId}`,
  };
}

export async function saveStripeSettings(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const organizationId = formData.get("organizationId") as string;
  const secretKey = ((formData.get("secretKey") as string) ?? "").trim();
  const webhookSecret = ((formData.get("webhookSecret") as string) ?? "").trim();
  const depositAccountId = formData.get("depositAccountId") as string;
  if ((await getCurrentUserRole(organizationId)) !== "owner") return { error: "Only an owner can set up Stripe" };
  if (!depositAccountId) return { error: "Choose the account Stripe payments go into" };
  if (secretKey && !isStripeSecretKey(secretKey)) return { error: "That isn't a Stripe secret or restricted key (sk_… or rk_…)" };
  if (webhookSecret && !/^whsec_[A-Za-z0-9]+$/.test(webhookSecret)) return { error: "A webhook signing secret starts with whsec_" };

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("organization_stripe_settings")
    .select("secret_key")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!existing && !secretKey) return { error: "Paste the Stripe secret key" };

  // The account must be one of this book's assets (the trigger checks the book too).
  const { data: account } = await (await createClient())
    .from("accounts")
    .select("id")
    .eq("id", depositAccountId)
    .eq("organization_id", organizationId)
    .eq("type", "asset")
    .maybeSingle();
  if (!account) return { error: "Choose one of this book's asset accounts" };

  const { error } = await admin.from("organization_stripe_settings").upsert({
    organization_id: organizationId,
    // A blank field keeps what was saved.
    secret_key: secretKey ? encryptToken(secretKey) : (existing!.secret_key as string),
    ...(webhookSecret ? { webhook_secret: encryptToken(webhookSecret) } : {}),
    deposit_account_id: depositAccountId,
    updated_at: new Date().toISOString(),
  });
  if (error) return { error: "Couldn't save the Stripe settings" };
  return { ok: true, message: "Saved." };
}

export async function removeStripeSettings(organizationId: string): Promise<ActionResult> {
  if ((await getCurrentUserRole(organizationId)) !== "owner") return { error: "Only an owner can remove Stripe" };
  await createAdminClient().from("organization_stripe_settings").delete().eq("organization_id", organizationId);
  return { ok: true, message: "Removed." };
}

export interface InvoiceLinkStatus {
  canCreate: boolean;
  link: { url: string; amount: number; status: string } | null;
}

export async function getInvoiceLinkStatus(invoiceId: string): Promise<InvoiceLinkStatus> {
  const supabase = await createClient();
  const { data: invoice } = await supabase.from("invoices").select("organization_id").eq("id", invoiceId).maybeSingle();
  if (!invoice) return { canCreate: false, link: null };
  const [role, { data: settings }, { data: link }] = await Promise.all([
    getCurrentUserRole(invoice.organization_id as string),
    createAdminClient()
      .from("organization_stripe_settings")
      .select("organization_id")
      .eq("organization_id", invoice.organization_id)
      .maybeSingle(),
    supabase
      .from("invoice_payment_links")
      .select("url, amount, status")
      .eq("invoice_id", invoiceId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  return {
    canCreate: canWrite(role) && !!settings,
    link: link ? { url: link.url as string, amount: Number(link.amount), status: link.status as string } : null,
  };
}

// A link for what's still owed on the invoice. An open one for the same
// amount is reused; one for an old amount is closed and replaced.
export async function createInvoicePaymentLink(invoiceId: string): Promise<ActionResult & { url?: string }> {
  const supabase = await createClient();
  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, organization_id, invoice_number, status, tax_amount, invoice_lines(amount), invoice_payments(amount)")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!invoice) return { error: "Invoice not found" };
  const orgId = invoice.organization_id as string;
  if (!canWrite(await getCurrentUserRole(orgId))) return { error: "Only an owner or accountant can make payment links" };
  if (invoice.status === "paid" || invoice.status === "void") return { error: `The invoice is ${invoice.status}` };

  const sum = (rows: { amount: number | string }[] | null) => (rows ?? []).reduce((s, r) => s + Number(r.amount), 0);
  const remaining =
    Math.round((sum(invoice.invoice_lines) + Number(invoice.tax_amount) - sum(invoice.invoice_payments)) * 100) / 100;
  if (remaining <= 0) return { error: "Nothing is owed on this invoice" };

  const admin = createAdminClient();
  const { data: settings } = await admin
    .from("organization_stripe_settings")
    .select("secret_key")
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!settings) return { error: "Stripe isn't set up for this book (Settings → Stripe)" };

  const { data: open } = await admin
    .from("invoice_payment_links")
    .select("url, amount, stripe_payment_link_id")
    .eq("invoice_id", invoiceId)
    .eq("status", "open");
  const same = (open ?? []).find((l) => Number(l.amount) === remaining);
  if (same) return { ok: true, url: same.url as string };

  const secretKey = decryptToken(settings.secret_key as string);
  // Best-effort: a link left on at Stripe is still recorded once paid.
  for (const stale of open ?? []) {
    await deactivatePaymentLink(secretKey, stale.stripe_payment_link_id as string).catch(() => {});
  }

  try {
    const currency = await getBookCurrency(orgId);
    const link = await createPaymentLink(secretKey, {
      name: `Invoice ${invoice.invoice_number}`,
      amount: remaining,
      currency,
      invoiceId,
    });
    if ((open ?? []).length > 0) {
      await admin.from("invoice_payment_links").update({ status: "closed" }).eq("invoice_id", invoiceId).eq("status", "open");
    }
    const { error } = await admin.from("invoice_payment_links").insert({
      organization_id: orgId,
      invoice_id: invoiceId,
      stripe_payment_link_id: link.id,
      url: link.url,
      amount: remaining,
    });
    if (error) return { error: "Stripe made the link, but it couldn't be saved" };
    return { ok: true, url: link.url };
  } catch (err) {
    return { error: err instanceof Error ? err.message.slice(0, 300) : "Couldn't reach Stripe" };
  }
}
