// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHmac, randomBytes } from "node:crypto";
import { request } from "node:https";
import { isIP } from "node:net";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptToken } from "@/lib/crypto/token-encryption";
import { publicLookup, resolvePublicAddress } from "@/lib/net/public-address";

// Server-only: the queue and the sending. Everything here uses the
// service-role key, so callers check who's asking first.

const TIMEOUT_MS = 10_000;
// Minutes to wait after each failed attempt; after the last, it's failed.
const RETRY_MINUTES = [1, 5, 30, 120, 720];
// How long a claimed delivery stays claimed, so two runs never send it twice.
const LEASE_MS = 2 * 60_000;
const BATCH_SIZE = 20;
const KEEP_DAYS = 30;

export type WebhookEvent = "invoice:created" | "bill:created" | "invoice_payment:recorded" | "bill_payment:recorded";

export interface DeliveryResult {
  delivered: boolean;
  status?: number;
  error?: string;
}

export function newWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString("base64url")}`;
}

// What receivers check: HMAC-SHA256 of "<timestamp>.<body>" with the secret.
export function signWebhook(secret: string, timestamp: number, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

// One POST to a public address, no redirects followed (a redirect could
// point anywhere), all done within TIMEOUT_MS.
export async function postWebhook(url: string, body: string, headers: Record<string, string>): Promise<DeliveryResult> {
  // Node skips `lookup` for an address written in the URL, so check it here.
  const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    try {
      await resolvePublicAddress(host);
    } catch (err) {
      return { delivered: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: DeliveryResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    let req: ReturnType<typeof request>;
    try {
      req = request(
        url,
        {
          method: "POST",
          lookup: publicLookup,
          headers: {
            ...headers,
            "content-type": "application/json",
            "content-length": String(Buffer.byteLength(body)),
            "user-agent": "FOQB-Webhooks",
          },
        },
        (res) => {
          const status = res.statusCode ?? 0;
          res.destroy();
          finish({ delivered: status >= 200 && status < 300, status });
        },
      );
    } catch (err) {
      resolve({ delivered: false, error: err instanceof Error ? err.message : String(err) });
      return;
    }
    const timer = setTimeout(() => req.destroy(new Error(`no response in ${TIMEOUT_MS / 1000} s`)), TIMEOUT_MS);
    req.on("error", (err) => finish({ delivered: false, error: err.message.slice(0, 300) }));
    req.end(body);
  });
}

// Queues one delivery per subscribed webhook, then sends them once the
// response that caused the event has gone out.
export async function enqueueWebhookEvent(event: WebhookEvent, data: { orgId: string }): Promise<void> {
  const admin = createAdminClient();
  const { data: hooks, error } = await admin
    .from("organization_webhooks")
    .select("id")
    .eq("organization_id", data.orgId)
    .contains("events", [event]);
  if (error) throw new Error(`Couldn't read webhooks: ${error.message}`);
  if (!hooks || hooks.length === 0) return;

  const { orgId, ...payload } = data;
  const { data: rows, error: insertError } = await admin
    .from("webhook_deliveries")
    .insert(hooks.map((h) => ({ organization_id: orgId, webhook_id: h.id as string, event, payload })))
    .select("id");
  if (insertError) throw new Error(`Couldn't queue webhooks: ${insertError.message}`);

  const send = () => Promise.all((rows ?? []).map((r) => deliverWebhook(r.id as string)));
  try {
    after(send);
  } catch {
    // Outside a request (a script, a test): send now, without waiting.
    void send().catch((err) => console.error("[webhooks] delivery failed", err));
  }
}

interface ClaimedDelivery {
  id: string;
  organization_id: string;
  event: string;
  payload: Record<string, unknown>;
  attempts: number;
  created_at: string;
  webhook: { url: string; secret_encrypted: string } | null;
}

// Sends one queued delivery if it's due and no one else has claimed it,
// and records the outcome. Returns null when there was nothing to send.
export async function deliverWebhook(id: string): Promise<DeliveryResult | null> {
  const admin = createAdminClient();
  const now = new Date();
  const { data, error } = await admin
    .from("webhook_deliveries")
    .update({ next_attempt_at: new Date(now.getTime() + LEASE_MS).toISOString() })
    .eq("id", id)
    .eq("status", "pending")
    .lte("next_attempt_at", now.toISOString())
    .select("id, organization_id, event, payload, attempts, created_at, webhook:organization_webhooks(url, secret_encrypted)")
    .maybeSingle();
  if (error) throw new Error(`Couldn't claim webhook delivery: ${error.message}`);
  const delivery = data as unknown as ClaimedDelivery | null;
  if (!delivery?.webhook) return null;

  const body = JSON.stringify({
    id: delivery.id,
    event: delivery.event,
    created_at: delivery.created_at,
    organization_id: delivery.organization_id,
    data: delivery.payload,
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const result = await postWebhook(delivery.webhook.url, body, {
    "x-foqb-event": delivery.event,
    "x-foqb-delivery": delivery.id,
    "x-foqb-timestamp": String(timestamp),
    "x-foqb-signature": signWebhook(decryptToken(delivery.webhook.secret_encrypted), timestamp, body),
  });

  const attempts = delivery.attempts + 1;
  const retryIn = RETRY_MINUTES[attempts - 1];
  const outcome = result.delivered
    ? { status: "delivered", delivered_at: new Date().toISOString() }
    : retryIn === undefined
      ? { status: "failed" }
      : { next_attempt_at: new Date(Date.now() + retryIn * 60_000).toISOString() };
  const { error: updateError } = await admin
    .from("webhook_deliveries")
    .update({
      attempts,
      last_response_status: result.status ?? null,
      last_error: result.error ?? (result.delivered ? null : `HTTP ${result.status}`),
      ...outcome,
    })
    .eq("id", delivery.id);
  if (updateError) console.error("[webhooks] couldn't record a delivery attempt", updateError);

  return result;
}

// The background job: retries what's due, and forgets old deliveries.
export async function deliverDueWebhooks(): Promise<{ attempted: number }> {
  const admin = createAdminClient();
  const { data: due, error } = await admin
    .from("webhook_deliveries")
    .select("id")
    .eq("status", "pending")
    .lte("next_attempt_at", new Date().toISOString())
    .order("next_attempt_at")
    .limit(BATCH_SIZE);
  if (error) throw new Error(`Couldn't read due webhooks: ${error.message}`);

  await Promise.all((due ?? []).map((d) => deliverWebhook(d.id as string)));

  const cutoff = new Date(Date.now() - KEEP_DAYS * 24 * 60 * 60_000).toISOString();
  await admin.from("webhook_deliveries").delete().neq("status", "pending").lt("created_at", cutoff);

  return { attempted: due?.length ?? 0 };
}
