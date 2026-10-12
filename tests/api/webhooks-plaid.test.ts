import { beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { createSupabaseMock, ok } from "./supabase-mock";
import { encryptToken } from "@/lib/crypto/token-encryption";

const {
  createAdminClientMock,
  getWebhookVerificationKeyMock,
  syncTransactionsMock,
  processBankTransactionsMock,
  processRemovedTransactionsMock,
  afterState,
} = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  getWebhookVerificationKeyMock: vi.fn(),
  syncTransactionsMock: vi.fn(),
  processBankTransactionsMock: vi.fn(),
  processRemovedTransactionsMock: vi.fn(),
  afterState: { promise: undefined as Promise<unknown> | undefined },
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));

vi.mock("@/lib/plaid/client", () => ({
  getWebhookVerificationKey: getWebhookVerificationKeyMock,
  syncTransactions: syncTransactionsMock,
}));

vi.mock("@/lib/plaid/processor", () => ({
  processBankTransactions: processBankTransactionsMock,
  processRemovedTransactions: processRemovedTransactionsMock,
}));

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: (fn: () => unknown) => {
      afterState.promise = Promise.resolve().then(fn);
    },
  };
});

import { POST } from "@/app/api/webhooks/plaid/route";

const KEY_ID = "test-key-1";

async function signWebhook(
  rawBody: string,
  options: { issuedAt?: Date; privateKey?: CryptoKey; requestBodyHash?: string } = {},
  signingKey: CryptoKey,
): Promise<string> {
  const requestBodyHash =
    options.requestBodyHash ?? crypto.createHash("sha256").update(rawBody).digest("hex");

  return new SignJWT({ request_body_sha256: requestBodyHash })
    .setProtectedHeader({ alg: "ES256", kid: KEY_ID })
    .setIssuedAt(options.issuedAt ?? new Date())
    .sign(options.privateKey ?? signingKey);
}

function makeRequest(body: unknown, jwt?: string): NextRequest {
  const rawBody = JSON.stringify(body);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (jwt) {
    headers["Plaid-Verification"] = jwt;
  }

  return new NextRequest("http://localhost/api/webhooks/plaid", {
    method: "POST",
    body: rawBody,
    headers,
  });
}

describe("POST /api/webhooks/plaid", () => {
  let publicJwk: Awaited<ReturnType<typeof exportJWK>>;
  let privateKey: CryptoKey;
  let otherPrivateKey: CryptoKey;

  beforeEach(async () => {
    const pair = await generateKeyPair("ES256");
    privateKey = pair.privateKey;
    publicJwk = await exportJWK(pair.publicKey);

    const otherPair = await generateKeyPair("ES256");
    otherPrivateKey = otherPair.privateKey;

    createAdminClientMock.mockReset();
    getWebhookVerificationKeyMock.mockReset();
    syncTransactionsMock.mockReset();
    processBankTransactionsMock.mockReset();
    processRemovedTransactionsMock.mockReset();
    afterState.promise = undefined;

    getWebhookVerificationKeyMock.mockResolvedValue({ ...publicJwk, kid: KEY_ID });
  });

  it("rejects a request with no signature header", async () => {
    const response = await POST(makeRequest({ webhook_type: "ping", webhook_code: "PING" }));
    expect(response.status).toBe(401);
  });

  it("rejects a request with a stale timestamp", async () => {
    const body = { webhook_type: "ping", webhook_code: "PING" };
    const rawBody = JSON.stringify(body);
    const staleDate = new Date(Date.now() - 10 * 60 * 1000);
    const jwt = await signWebhook(rawBody, { issuedAt: staleDate }, privateKey);

    const response = await POST(makeRequest(body, jwt));
    expect(response.status).toBe(401);
  });

  it("rejects a request signed with the wrong key", async () => {
    const body = { webhook_type: "ping", webhook_code: "PING" };
    const rawBody = JSON.stringify(body);
    const jwt = await signWebhook(rawBody, {}, otherPrivateKey);

    const response = await POST(makeRequest(body, jwt));
    expect(response.status).toBe(401);
  });

  it("rejects a request whose body hash doesn't match the signed claim", async () => {
    const body = { webhook_type: "ping", webhook_code: "PING" };
    const rawBody = JSON.stringify(body);
    const jwt = await signWebhook(rawBody, { requestBodyHash: "0".repeat(64) }, privateKey);

    const response = await POST(makeRequest(body, jwt));
    expect(response.status).toBe(401);
  });

  it("rejects a request signed with a key Plaid has expired", async () => {
    getWebhookVerificationKeyMock.mockResolvedValue({ ...publicJwk, kid: KEY_ID, expired_at: 1700000000 });
    const body = { webhook_type: "ping", webhook_code: "PING" };
    const jwt = await signWebhook(JSON.stringify(body), {}, privateKey);

    const response = await POST(makeRequest(body, jwt));
    expect(response.status).toBe(401);
  });

  it("accepts a validly signed request and responds immediately", async () => {
    const body = { webhook_type: "unknown", webhook_code: "SOMETHING", item_id: "item_1" };
    const jwt = await signWebhook(JSON.stringify(body), {}, privateKey);

    const response = await POST(makeRequest(body, jwt));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true });
  });

  it("syncs transactions and updates the cursor on SYNC_UPDATES_AVAILABLE", async () => {
    const { client, tables } = createSupabaseMock({
      tables: {
        enrollments: {
          select: ok({
            id: "enrollment-1",
            organization_id: "org-1",
            access_token: encryptToken("tok"),
            cursor: "old-cursor",
          }),
          update: ok(null),
        },
        accounts: { select: ok({ id: "ledger-account-1" }) },
      },
    });
    createAdminClientMock.mockReturnValue(client);
    syncTransactionsMock.mockResolvedValue({
      added: [{ id: "txn_1", account_id: "acc_plaid_1", amount: 5, date: "2026-01-01", name: "X" }],
      modified: [],
      removed: [],
      nextCursor: "new-cursor",
      hasMore: false,
    });

    const body = { webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE", item_id: "item_1" };
    const jwt = await signWebhook(JSON.stringify(body), {}, privateKey);

    const response = await POST(makeRequest(body, jwt));
    expect(response.status).toBe(200);

    await afterState.promise;

    expect(syncTransactionsMock).toHaveBeenCalledWith("tok", "old-cursor");
    expect(processBankTransactionsMock).toHaveBeenCalledWith(
      "org-1",
      "ledger-account-1",
      expect.any(Array),
    );
    expect(tables.enrollments.update).toHaveBeenCalledWith({ cursor: "new-cursor" });
  });

  it("pulls every page before saving the final cursor", async () => {
    const { client, tables } = createSupabaseMock({
      tables: {
        enrollments: {
          select: ok({
            id: "enrollment-1",
            organization_id: "org-1",
            access_token: encryptToken("tok"),
            cursor: null,
          }),
          update: ok(null),
        },
        accounts: { select: ok({ id: "ledger-account-1" }) },
      },
    });
    createAdminClientMock.mockReturnValue(client);
    const page = (id: string, nextCursor: string, hasMore: boolean) => ({
      added: [{ id, account_id: "acc_plaid_1", amount: 5, date: "2026-01-01", name: "X" }],
      modified: [],
      removed: [],
      nextCursor,
      hasMore,
    });
    syncTransactionsMock
      .mockResolvedValueOnce(page("txn_1", "c1", true))
      .mockResolvedValueOnce(page("txn_2", "c2", false));

    const body = { webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE", item_id: "item_1" };
    const jwt = await signWebhook(JSON.stringify(body), {}, privateKey);

    await POST(makeRequest(body, jwt));
    await afterState.promise;

    expect(syncTransactionsMock).toHaveBeenNthCalledWith(1, "tok", null);
    expect(syncTransactionsMock).toHaveBeenNthCalledWith(2, "tok", "c1");
    expect(processBankTransactionsMock).toHaveBeenCalledTimes(2);
    expect(tables.enrollments.update).toHaveBeenCalledTimes(1);
    expect(tables.enrollments.update).toHaveBeenCalledWith({ cursor: "c2" });
  });

  it("keeps the old cursor when processing a page fails", async () => {
    const { client, tables } = createSupabaseMock({
      tables: {
        enrollments: {
          select: ok({
            id: "enrollment-1",
            organization_id: "org-1",
            access_token: encryptToken("tok"),
            cursor: "old-cursor",
          }),
          update: ok(null),
        },
        accounts: { select: ok({ id: "ledger-account-1" }) },
      },
    });
    createAdminClientMock.mockReturnValue(client);
    syncTransactionsMock.mockResolvedValue({
      added: [{ id: "txn_1", account_id: "acc_plaid_1", amount: 5, date: "2026-01-01", name: "X" }],
      modified: [],
      removed: [],
      nextCursor: "new-cursor",
      hasMore: false,
    });
    processBankTransactionsMock.mockRejectedValueOnce(new Error("db down"));

    const body = { webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE", item_id: "item_1" };
    const jwt = await signWebhook(JSON.stringify(body), {}, privateKey);

    await POST(makeRequest(body, jwt));
    await afterState.promise;

    expect(tables.enrollments.update).not.toHaveBeenCalled();
  });

  it("processes removed transactions reported by sync", async () => {
    const { client } = createSupabaseMock({
      tables: {
        enrollments: {
          select: ok({
            id: "enrollment-1",
            organization_id: "org-1",
            access_token: encryptToken("tok"),
            cursor: null,
          }),
          update: ok(null),
        },
      },
    });
    createAdminClientMock.mockReturnValue(client);
    syncTransactionsMock.mockResolvedValue({
      added: [],
      modified: [],
      removed: [{ id: "txn_gone", accountId: "acc_plaid_1" }],
      nextCursor: "new-cursor",
      hasMore: false,
    });

    const body = { webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE", item_id: "item_1" };
    const jwt = await signWebhook(JSON.stringify(body), {}, privateKey);

    await POST(makeRequest(body, jwt));
    await afterState.promise;

    expect(processRemovedTransactionsMock).toHaveBeenCalledWith([
      { id: "txn_gone", accountId: "acc_plaid_1" },
    ]);
  });

  it("does nothing for SYNC_UPDATES_AVAILABLE when the Item is unknown", async () => {
    const { client } = createSupabaseMock({ tables: { enrollments: { select: ok(null) } } });
    createAdminClientMock.mockReturnValue(client);

    const body = { webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE", item_id: "item_missing" };
    const jwt = await signWebhook(JSON.stringify(body), {}, privateKey);

    await POST(makeRequest(body, jwt));
    await afterState.promise;

    expect(syncTransactionsMock).not.toHaveBeenCalled();
  });

  it.each([
    ["ERROR", "error", "the login details have changed"],
    ["PENDING_EXPIRATION", "expiring", "PENDING_EXPIRATION"],
    ["PENDING_DISCONNECT", "expiring", "PENDING_DISCONNECT"],
    ["USER_PERMISSION_REVOKED", "disconnected", "USER_PERMISSION_REVOKED"],
    ["LOGIN_REPAIRED", "active", null],
  ])("maps ITEM %s to enrollment status %s", async (code, status, reason) => {
    const { client, tables } = createSupabaseMock({
      tables: { enrollments: { update: ok(null) } },
    });
    createAdminClientMock.mockReturnValue(client);

    const body = {
      webhook_type: "ITEM",
      webhook_code: code,
      item_id: "item_1",
      ...(code === "ERROR" ? { error: { error_message: "the login details have changed" } } : {}),
    };
    const jwt = await signWebhook(JSON.stringify(body), {}, privateKey);

    await POST(makeRequest(body, jwt));
    await afterState.promise;

    expect(tables.enrollments.update).toHaveBeenCalledWith({ status, disconnect_reason: reason });
    expect(tables.enrollments.eq).toHaveBeenCalledWith("external_item_id", "item_1");
    // A webhook never revives an enrollment the user (or the bank) disconnected.
    expect(tables.enrollments.neq).toHaveBeenCalledWith("status", "disconnected");
  });

  it("ignores ITEM webhooks it doesn't act on", async () => {
    const { client, tables } = createSupabaseMock({ tables: { enrollments: { update: ok(null) } } });
    createAdminClientMock.mockReturnValue(client);

    const body = { webhook_type: "ITEM", webhook_code: "WEBHOOK_UPDATE_ACKNOWLEDGED", item_id: "item_1" };
    const jwt = await signWebhook(JSON.stringify(body), {}, privateKey);

    await POST(makeRequest(body, jwt));
    await afterState.promise;

    expect(tables.enrollments.update).not.toHaveBeenCalled();
  });

  it("ignores events with no item_id in the payload", async () => {
    const body = { webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE" };
    const jwt = await signWebhook(JSON.stringify(body), {}, privateKey);

    const response = await POST(makeRequest(body, jwt));
    expect(response.status).toBe(200);
    await afterState.promise;
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });
});
