// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUserRole } from "@/lib/org/current";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { encryptToken } from "@/lib/crypto/token-encryption";
import { resolvePublicAddress } from "@/lib/net/public-address";
import { deliverWebhook, newWebhookSecret, type WebhookEvent } from "./delivery";

const EVENTS: WebhookEvent[] = ["invoice:created", "bill:created", "invoice_payment:recorded", "bill_payment:recorded"];
const MAX_WEBHOOKS = 10;
const TEST_LIMIT = 10;

export interface Webhook {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  created_at: string;
}

export interface WebhookDelivery {
  id: string;
  webhook_id: string;
  event: string;
  status: "pending" | "delivered" | "failed";
  attempts: number;
  last_response_status: number | null;
  last_error: string | null;
  created_at: string;
}

export type CreateResult = { error: string } | { ok: true; secret: string; url: string };
export type TestResult = { error: string } | { ok: true; message: string };

async function isOwner(organizationId: string): Promise<boolean> {
  return (await getCurrentUserRole(organizationId)) === "owner";
}

// Owners only; null for anyone else.
export async function getWebhooks(
  organizationId: string,
): Promise<{ webhooks: Webhook[]; deliveries: WebhookDelivery[] } | null> {
  if (!(await isOwner(organizationId))) return null;
  const supabase = await createClient();
  const [{ data: webhooks }, { data: deliveries }] = await Promise.all([
    supabase
      .from("organization_webhooks")
      .select("id, url, description, events, created_at")
      .eq("organization_id", organizationId)
      .order("created_at"),
    supabase
      .from("webhook_deliveries")
      .select("id, webhook_id, event, status, attempts, last_response_status, last_error, created_at")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  return { webhooks: (webhooks ?? []) as Webhook[], deliveries: (deliveries ?? []) as WebhookDelivery[] };
}

export async function createWebhook(_prev: CreateResult | null, formData: FormData): Promise<CreateResult> {
  const organizationId = String(formData.get("organizationId") ?? "");
  const rawUrl = String(formData.get("url") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const events = formData.getAll("events").map(String);

  if (!(await isOwner(organizationId))) return { error: "Only an owner can add webhooks." };

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { error: "Enter the full URL, starting with https://" };
  }
  if (url.protocol !== "https:" || rawUrl.length > 2000) return { error: "The URL must start with https://" };
  if (url.username || url.password) return { error: "Put credentials in the receiver's checks, not the URL." };
  if (events.length === 0 || !events.every((e) => EVENTS.includes(e as WebhookEvent))) {
    return { error: "Choose at least one event." };
  }
  if (description && description.length > 200) return { error: "Keep the description under 200 characters." };
  try {
    await resolvePublicAddress(url.hostname);
  } catch (err) {
    return { error: `Can't send there: ${err instanceof Error ? err.message : String(err)}` };
  }

  const supabase = await createClient();
  const { count } = await supabase
    .from("organization_webhooks")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId);
  if ((count ?? 0) >= MAX_WEBHOOKS) return { error: `An organization can have up to ${MAX_WEBHOOKS} webhooks.` };

  const secret = newWebhookSecret();
  const { error } = await supabase.from("organization_webhooks").insert({
    organization_id: organizationId,
    url: url.toString(),
    description,
    events,
    secret_encrypted: encryptToken(secret),
  });
  if (error) return { error: error.message };
  return { ok: true, secret, url: url.toString() };
}

export async function deleteWebhook(organizationId: string, webhookId: string): Promise<void> {
  if (!(await isOwner(organizationId))) return;
  const supabase = await createClient();
  await supabase.from("organization_webhooks").delete().eq("id", webhookId).eq("organization_id", organizationId);
}

// Sends a "ping" right away and reports how the receiver answered.
export async function sendTestWebhook(organizationId: string, webhookId: string): Promise<TestResult> {
  if (!(await isOwner(organizationId))) return { error: "Only an owner can test webhooks." };
  const supabase = await createClient();
  const { data: webhook } = await supabase
    .from("organization_webhooks")
    .select("id")
    .eq("id", webhookId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!webhook) return { error: "Webhook not found." };
  if (!(await checkRateLimit("webhook-test", organizationId, TEST_LIMIT, 3600))) {
    return { error: "Too many tests; try again in an hour." };
  }

  const { data: queued, error } = await createAdminClient()
    .from("webhook_deliveries")
    .insert({
      organization_id: organizationId,
      webhook_id: webhookId,
      event: "ping",
      payload: { message: "A test from FOQB." },
    })
    .select("id")
    .single();
  if (error || !queued) return { error: `Couldn't queue the test: ${error?.message ?? "unknown error"}` };

  const result = await deliverWebhook(queued.id as string);
  if (!result) return { error: "The test is already being sent." };
  if (result.delivered) return { ok: true, message: `Delivered: the receiver answered ${result.status}.` };
  return {
    error: result.status
      ? `The receiver answered ${result.status}; it will be retried.`
      : `Couldn't deliver: ${result.error}. It will be retried.`,
  };
}
