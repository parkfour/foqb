import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import crypto from "node:crypto";
import { importJWK, jwtVerify } from "jose";
import { createAdminClient } from "@/lib/supabase/admin";
import { getWebhookVerificationKey } from "@/lib/plaid/client";
import { syncItem } from "@/lib/plaid/sync";

const MAX_TOKEN_AGE_SECONDS = 300;

interface PlaidWebhookEvent {
  webhook_type: string;
  webhook_code: string;
  item_id?: string;
  error?: { error_message?: string } | null;
}

function base64UrlDecode(segment: string): string {
  return Buffer.from(segment, "base64url").toString("utf8");
}

async function isValidSignature(rawBody: string, header: string | null): Promise<boolean> {
  if (!header) return false;

  const parts = header.split(".");
  if (parts.length !== 3) return false;

  let headerClaims: { alg?: string; kid?: string };
  try {
    headerClaims = JSON.parse(base64UrlDecode(parts[0]));
  } catch {
    return false;
  }

  if (headerClaims.alg !== "ES256" || !headerClaims.kid) return false;

  try {
    const key = await getWebhookVerificationKey(headerClaims.kid);
    if (key.expired_at != null) return false;
    const keyLike = await importJWK(key, "ES256");

    const { payload } = await jwtVerify(header, keyLike, {
      maxTokenAge: `${MAX_TOKEN_AGE_SECONDS} s`,
    });

    const expectedHash = payload.request_body_sha256 as string | undefined;
    if (!expectedHash) return false;

    const actualHash = crypto.createHash("sha256").update(rawBody).digest("hex");

    const expectedBuffer = Buffer.from(expectedHash, "hex");
    const actualBuffer = Buffer.from(actualHash, "hex");
    if (expectedBuffer.length !== actualBuffer.length) return false;

    return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
  } catch (error) {
    console.error("Plaid webhook signature verification failed", error);
    return false;
  }
}

// ITEM webhook -> enrollment status. 'error'/'expiring' are fixed by the user
// reconnecting through Link update mode (Settings -> Reconnect), which keeps
// the same Item and account/transaction ids; 'disconnected' Items are gone
// and have to be linked again.
const ITEM_STATUS: Record<string, "active" | "expiring" | "error" | "disconnected"> = {
  ERROR: "error",
  PENDING_EXPIRATION: "expiring",
  PENDING_DISCONNECT: "expiring",
  LOGIN_REPAIRED: "active",
  USER_PERMISSION_REVOKED: "disconnected",
  USER_ACCOUNT_REVOKED: "disconnected",
};

async function handleItemStatus(itemId: string, status: string, reason: string | null) {
  const supabase = createAdminClient();

  // A disconnected enrollment's Item is gone (or was removed by the user) —
  // a late webhook must not bring it back.
  const { error } = await supabase
    .from("enrollments")
    .update({ status, disconnect_reason: reason })
    .eq("external_item_id", itemId)
    .neq("status", "disconnected");

  if (error) {
    console.error(`Failed to set enrollment for Item ${itemId} to ${status}`, error);
  }
}

async function processEvent(event: PlaidWebhookEvent) {
  const itemId = event.item_id;
  if (!itemId) return;

  if (event.webhook_type === "TRANSACTIONS" && event.webhook_code === "SYNC_UPDATES_AVAILABLE") {
    await syncItem(itemId);
  }

  const itemStatus = event.webhook_type === "ITEM" ? ITEM_STATUS[event.webhook_code] : undefined;
  if (itemStatus) {
    const reason = itemStatus === "active" ? null : (event.error?.error_message ?? event.webhook_code);
    await handleItemStatus(itemId, itemStatus, reason);
  }
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signatureHeader = req.headers.get("Plaid-Verification");

  if (!(await isValidSignature(rawBody, signatureHeader))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const event = JSON.parse(rawBody) as PlaidWebhookEvent;

  // A failed sync leaves the enrollment's cursor where it was (it's only
  // saved after every page is processed), so the next webhook retries it.
  after(() =>
    processEvent(event).catch((error) => {
      console.error(`Plaid webhook ${event.webhook_type}/${event.webhook_code} failed`, error);
    }),
  );

  return NextResponse.json({ received: true });
}
