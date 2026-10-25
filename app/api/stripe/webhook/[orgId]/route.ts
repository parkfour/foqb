import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptToken } from "@/lib/crypto/token-encryption";
import { enabledPluginIds } from "@/lib/plugins/loader";
import { getOrgEnabledPluginIds } from "@/lib/plugins/settings";
import { findAccountsReceivableAccount } from "@/lib/org/control-accounts";
import { instanceTimezone } from "@/lib/org/book-clock";
import { localDate } from "@/lib/time/book-time";
import { emitHook } from "@/lib/plugins/hooks";
import { ensureServerPluginsLoaded } from "@/lib/plugins/server-loader";
import { deactivatePaymentLink, fromMinorUnits, verifyStripeSignature } from "@/plugins/stripe-payments/stripe";

// Stripe calls this when a payment link is paid (checkout.session.completed)
// for the book in the path. Signed with that book's webhook secret; the
// payment is recorded against the invoice the link was made for, into the
// deposit account chosen in Settings, once.
export async function POST(req: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const body = await req.text();
  const admin = createAdminClient();

  if (!enabledPluginIds().includes("stripe-payments")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { data: settings } = await admin
    .from("organization_stripe_settings")
    .select("secret_key, webhook_secret, deposit_account_id")
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!settings?.webhook_secret) return NextResponse.json({ error: "Not set up" }, { status: 404 });
  if (!verifyStripeSignature(body, req.headers.get("stripe-signature"), decryptToken(settings.webhook_secret as string))) {
    return NextResponse.json({ error: "Bad signature" }, { status: 400 });
  }
  if (!(await getOrgEnabledPluginIds(admin, orgId)).includes("stripe-payments")) {
    return NextResponse.json({ received: true, ignored: "plugin off for this book" });
  }

  const event = JSON.parse(body) as {
    type: string;
    data: { object: { payment_link?: string | null; payment_status?: string; amount_total?: number; currency?: string } };
  };
  const session = event.data.object;
  if (event.type !== "checkout.session.completed" || session.payment_status !== "paid" || !session.payment_link) {
    return NextResponse.json({ received: true });
  }

  const { data: link } = await admin
    .from("invoice_payment_links")
    .select("id, invoice_id, status")
    .eq("organization_id", orgId)
    .eq("stripe_payment_link_id", session.payment_link)
    .maybeSingle();
  // Someone else's link, or already recorded (Stripe can send an event twice).
  if (!link || link.status === "paid") return NextResponse.json({ received: true });

  const arAccount = await findAccountsReceivableAccount(admin, orgId);
  if ("error" in arAccount) {
    console.error(`Stripe payment for book ${orgId} not recorded: ${arAccount.error}`);
    return NextResponse.json({ error: arAccount.error }, { status: 500 });
  }
  const amount = fromMinorUnits(session.amount_total ?? 0, session.currency ?? "usd");
  // The book's today (no one is signed in here to read it the usual way).
  const { data: org } = await admin.from("organizations").select("timezone").eq("id", orgId).maybeSingle();
  const today = localDate((org?.timezone as string | null) ?? instanceTimezone());
  const { data, error } = await admin.rpc("record_invoice_payment", {
    p_invoice_id: link.invoice_id,
    p_payment_date: today,
    p_amount: amount,
    p_deposit_account_id: settings.deposit_account_id,
    p_ar_account_id: arAccount.id,
    p_bank_transaction_id: null,
  });
  if (error) {
    // Paid by other means meanwhile, say: retrying won't change it.
    console.error(`Stripe payment of ${amount} for invoice ${link.invoice_id} not recorded: ${error.message}`);
    await admin.from("invoice_payment_links").update({ status: "closed" }).eq("id", link.id);
    return NextResponse.json({ received: true, recorded: false });
  }

  const result = data as { id: string; status: string };
  await admin.from("invoice_payment_links").update({ status: "paid", invoice_payment_id: result.id }).eq("id", link.id);
  await deactivatePaymentLink(decryptToken(settings.secret_key as string), session.payment_link).catch(() => {});
  ensureServerPluginsLoaded();
  await emitHook("invoice_payment:recorded", {
    paymentId: result.id,
    invoiceId: link.invoice_id as string,
    invoiceStatus: result.status,
    orgId,
  });
  return NextResponse.json({ received: true, recorded: true });
}
