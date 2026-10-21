import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createSupabaseMock, fail, ok } from "./supabase-mock";
import { decryptToken } from "@/lib/crypto/token-encryption";

const {
  serverClientMock,
  exchangePublicTokenMock,
  getAccountsMock,
  removeItemMock,
  syncItemMock,
  blockedReasonMock,
} = vi.hoisted(() => ({
  serverClientMock: vi.fn(),
  exchangePublicTokenMock: vi.fn(),
  getAccountsMock: vi.fn(),
  removeItemMock: vi.fn(),
  syncItemMock: vi.fn(),
  blockedReasonMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: serverClientMock,
}));

vi.mock("@/lib/plaid/client", () => ({
  exchangePublicToken: exchangePublicTokenMock,
  getAccounts: getAccountsMock,
  removeItem: removeItemMock,
}));

vi.mock("@/lib/plaid/sync", () => ({ syncItem: syncItemMock }));
vi.mock("@/lib/plaid/bank-linking", () => ({ bankLinkingBlockedReason: blockedReasonMock }));

import { POST } from "@/app/api/bank/enroll/route";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/bank/enroll", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

// The accounts table mock intentionally has no `select` configured: the
// numbering lookup (supabase.from("accounts").select(...) before insert)
// then sees the mock's default `{ data: null }`, which nextAccountNumbers
// treats as "no existing accounts of this type" — exactly right for a
// fresh test org — while leaving `insert`'s configured return value intact
// for the route's own chained `.insert(...).select(...)` afterward.

describe("POST /api/bank/enroll", () => {
  beforeEach(() => {
    serverClientMock.mockReset();
    exchangePublicTokenMock.mockReset();
    getAccountsMock.mockReset();
    removeItemMock.mockReset();
    syncItemMock.mockReset();
    exchangePublicTokenMock.mockResolvedValue({ accessToken: "tok", itemId: "item_1" });
    getAccountsMock.mockResolvedValue([]);
    removeItemMock.mockResolvedValue(undefined);
    syncItemMock.mockResolvedValue(undefined);
    blockedReasonMock.mockReset().mockResolvedValue(null);
  });

  it("returns 400 when required fields are missing", async () => {
    const { client } = createSupabaseMock({ tables: {} });
    serverClientMock.mockResolvedValue(client);

    const response = await POST(makeRequest({ organizationId: "org-1" }));
    expect(response.status).toBe(400);
  });

  it("returns 401 when there is no authenticated user", async () => {
    const { client } = createSupabaseMock({ user: null, tables: {} });
    serverClientMock.mockResolvedValue(client);

    const response = await POST(
      makeRequest({ publicToken: "public-tok", organizationId: "org-1" }),
    );
    expect(response.status).toBe(401);
  });

  it("returns 403 when the user is not a member of the organization", async () => {
    const { client } = createSupabaseMock({
      user: { id: "user-1" },
      tables: { organization_members: { select: ok(null) } },
    });
    serverClientMock.mockResolvedValue(client);

    const response = await POST(
      makeRequest({ publicToken: "public-tok", organizationId: "org-1" }),
    );
    expect(response.status).toBe(403);
  });

  it("returns 403 without two-factor, before exchanging the token", async () => {
    const { client } = createSupabaseMock({
      user: { id: "user-1" },
      aal: "aal1",
      tables: { organization_members: { select: ok({ role: "owner" }) } },
    });
    serverClientMock.mockResolvedValue(client);

    const response = await POST(makeRequest({ publicToken: "public-tok", organizationId: "org-1" }));
    expect(response.status).toBe(403);
    expect(exchangePublicTokenMock).not.toHaveBeenCalled();
  });

  it("returns 403 when connecting banks is turned off, before exchanging the token", async () => {
    const { client } = createSupabaseMock({
      user: { id: "user-1" },
      tables: { organization_members: { select: ok({ role: "owner" }) } },
    });
    serverClientMock.mockResolvedValue(client);
    blockedReasonMock.mockResolvedValue("Connecting banks is turned off on this instance.");

    const response = await POST(makeRequest({ publicToken: "public-tok", organizationId: "org-1" }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Connecting banks is turned off on this instance." });
    expect(blockedReasonMock).toHaveBeenCalledWith(client, "org-1");
    expect(exchangePublicTokenMock).not.toHaveBeenCalled();
  });

  it("returns 403 for a viewer without exchanging the token (no orphaned Plaid Item)", async () => {
    const { client } = createSupabaseMock({
      user: { id: "user-1" },
      tables: { organization_members: { select: ok({ role: "viewer" }) } },
    });
    serverClientMock.mockResolvedValue(client);

    const response = await POST(makeRequest({ publicToken: "public-tok", organizationId: "org-1" }));
    expect(response.status).toBe(403);
    expect(exchangePublicTokenMock).not.toHaveBeenCalled();
  });

  it("returns 500 and removes the Plaid Item when saving the enrollment fails", async () => {
    const { client } = createSupabaseMock({
      user: { id: "user-1" },
      tables: {
        organization_members: { select: ok({ role: "owner" }) },
        enrollments: { insert: fail("duplicate key") },
      },
    });
    serverClientMock.mockResolvedValue(client);

    const response = await POST(
      makeRequest({ publicToken: "public-tok", organizationId: "org-1" }),
    );
    expect(response.status).toBe(500);
    expect(removeItemMock).toHaveBeenCalledWith("tok");
    expect(syncItemMock).not.toHaveBeenCalled();
  });

  it("creates ledger accounts before the enrollment, and removes the Item if that fails", async () => {
    const { client, tables } = createSupabaseMock({
      user: { id: "user-1" },
      tables: {
        organization_members: { select: ok({ role: "owner" }) },
        accounts: { insert: fail("permission denied") },
        enrollments: { insert: ok(null) },
      },
    });
    serverClientMock.mockResolvedValue(client);
    getAccountsMock.mockResolvedValue([
      { id: "acc_plaid_123", name: "Checking", type: "depository", subtype: "checking", mask: "1234" },
    ]);

    const response = await POST(makeRequest({ publicToken: "public-tok", organizationId: "org-1" }));
    expect(response.status).toBe(500);
    expect(tables.enrollments.insert).not.toHaveBeenCalled();
    expect(removeItemMock).toHaveBeenCalledWith("tok");
  });

  it("exchanges the public token, saves the enrollment with no cursor yet, and creates numbered accounts", async () => {
    const { client, tables } = createSupabaseMock({
      user: { id: "user-1" },
      tables: {
        organization_members: { select: ok({ role: "owner" }) },
        enrollments: { insert: ok(null) },
        accounts: {
          insert: ok([
            { id: "ledger-1", external_account_id: "acc_plaid_123" },
            { id: "ledger-2", external_account_id: "acc_plaid_456" },
          ]),
        },
      },
    });
    serverClientMock.mockResolvedValue(client);
    getAccountsMock.mockResolvedValue([
      { id: "acc_plaid_123", name: "Checking", type: "depository", subtype: "checking", mask: "1234" },
      { id: "acc_plaid_456", name: "Savings", type: "depository", subtype: "savings", mask: "5678" },
    ]);

    const response = await POST(
      makeRequest({
        publicToken: "public-tok",
        institutionName: "Test Bank",
        organizationId: "org-1",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });

    expect(exchangePublicTokenMock).toHaveBeenCalledWith("public-tok");

    expect(tables.enrollments.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: "org-1",
        external_item_id: "item_1",
        institution_name: "Test Bank",
        cursor: null,
      }),
    );
    const [enrollmentInsertArg] = tables.enrollments.insert.mock.calls[0] as [
      { access_token: string },
    ];
    // access_token is encrypted at rest — assert the stored value round-trips
    // back to the plaintext, not that it equals it literally.
    expect(enrollmentInsertArg.access_token).not.toBe("tok");
    expect(decryptToken(enrollmentInsertArg.access_token)).toBe("tok");

    // Sequential, consistent with the org's own numbering scheme (1000s for
    // asset) — not the raw Plaid account id, which is only kept in
    // external_account_id now. The mask is folded into the name for human
    // disambiguation between accounts that would otherwise share a name.
    expect(tables.accounts.insert).toHaveBeenCalledWith([
      {
        organization_id: "org-1",
        account_number: "1000",
        name: "Checking ••1234",
        type: "asset",
        description: "Linked via Plaid",
        external_account_id: "acc_plaid_123",
      },
      {
        organization_id: "org-1",
        account_number: "1001",
        name: "Savings ••5678",
        type: "asset",
        description: "Linked via Plaid",
        external_account_id: "acc_plaid_456",
      },
    ]);
  });

  it("maps credit and loan accounts to liability, everything else to asset, numbering each type block separately", async () => {
    const { client, tables } = createSupabaseMock({
      user: { id: "user-1" },
      tables: {
        organization_members: { select: ok({ role: "owner" }) },
        enrollments: { insert: ok(null) },
        accounts: {
          insert: ok([
            { id: "ledger-1", external_account_id: "acc_credit" },
            { id: "ledger-2", external_account_id: "acc_loan" },
            { id: "ledger-3", external_account_id: "acc_investment" },
          ]),
        },
      },
    });
    serverClientMock.mockResolvedValue(client);
    getAccountsMock.mockResolvedValue([
      { id: "acc_credit", name: "Credit Card", type: "credit", subtype: "credit card", mask: "1" },
      { id: "acc_loan", name: "Mortgage", type: "loan", subtype: "mortgage", mask: "2" },
      { id: "acc_investment", name: "IRA", type: "investment", subtype: "ira", mask: "3" },
    ]);

    await POST(makeRequest({ publicToken: "public-tok", organizationId: "org-1" }));

    expect(tables.accounts.insert).toHaveBeenCalledWith([
      expect.objectContaining({ account_number: "2000", type: "liability" }),
      expect.objectContaining({ account_number: "2001", type: "liability" }),
      expect.objectContaining({ account_number: "1000", type: "asset" }),
    ]);
  });

  it("stores the full Plaid account id in external_account_id, unmodified", async () => {
    const { client, tables } = createSupabaseMock({
      user: { id: "user-1" },
      tables: {
        organization_members: { select: ok({ role: "owner" }) },
        enrollments: { insert: ok(null) },
        accounts: {
          insert: ok([{ id: "ledger-1", external_account_id: "acc_plaid_way_too_long_to_fit_in_varchar20" }]),
        },
      },
    });
    serverClientMock.mockResolvedValue(client);
    getAccountsMock.mockResolvedValue([
      {
        id: "acc_plaid_way_too_long_to_fit_in_varchar20",
        name: "Checking",
        type: "depository",
        subtype: "checking",
        mask: "1234",
      },
    ]);

    await POST(makeRequest({ publicToken: "public-tok", organizationId: "org-1" }));

    const [rows] = tables.accounts.insert.mock.calls[0] as [
      Array<{ external_account_id: string; account_number: string }>,
    ];
    expect(rows[0].external_account_id).toBe("acc_plaid_way_too_long_to_fit_in_varchar20");
    expect(rows[0].account_number).toBe("1000");
  });

  it("backfills the new enrollment's full history through syncItem", async () => {
    const { client } = createSupabaseMock({
      user: { id: "user-1" },
      tables: {
        organization_members: { select: ok({ role: "owner" }) },
        enrollments: { insert: ok(null) },
      },
    });
    serverClientMock.mockResolvedValue(client);

    await POST(makeRequest({ publicToken: "public-tok", organizationId: "org-1" }));

    expect(syncItemMock).toHaveBeenCalledWith("item_1");
  });

  it("still returns success when the backfill fails", async () => {
    const { client } = createSupabaseMock({
      user: { id: "user-1" },
      tables: {
        organization_members: { select: ok({ role: "owner" }) },
        enrollments: { insert: ok(null) },
      },
    });
    serverClientMock.mockResolvedValue(client);
    syncItemMock.mockRejectedValue(new Error("Plaid API down"));

    const response = await POST(
      makeRequest({ publicToken: "public-tok", organizationId: "org-1" }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(removeItemMock).not.toHaveBeenCalled();
  });

  it("only imports the accounts named in selectedAccountIds", async () => {
    const { client, tables } = createSupabaseMock({
      user: { id: "user-1" },
      tables: {
        organization_members: { select: ok({ role: "owner" }) },
        enrollments: { insert: ok(null) },
        accounts: {
          insert: ok([{ id: "ledger-1", external_account_id: "acc_plaid_123" }]),
        },
      },
    });
    serverClientMock.mockResolvedValue(client);
    getAccountsMock.mockResolvedValue([
      { id: "acc_plaid_123", name: "Checking", type: "depository", subtype: "checking", mask: "1234" },
      { id: "acc_plaid_456", name: "Savings", type: "depository", subtype: "savings", mask: "5678" },
    ]);

    await POST(
      makeRequest({
        publicToken: "public-tok",
        organizationId: "org-1",
        selectedAccountIds: ["acc_plaid_123"],
      }),
    );

    expect(tables.accounts.insert).toHaveBeenCalledWith([
      expect.objectContaining({ external_account_id: "acc_plaid_123" }),
    ]);
  });

  it("links a bank account to an existing ledger account instead of creating one", async () => {
    const { client, tables } = createSupabaseMock({
      user: { id: "user-1" },
      tables: {
        organization_members: { select: ok({ role: "owner" }) },
        enrollments: { insert: ok(null) },
        accounts: { select: ok([{ id: "ledger-old" }]), update: ok(null), insert: ok([]) },
      },
    });
    serverClientMock.mockResolvedValue(client);
    getAccountsMock.mockResolvedValue([
      { id: "acc_plaid_123", name: "Checking", type: "depository", subtype: "checking", mask: "1234" },
      { id: "acc_plaid_456", name: "Savings", type: "depository", subtype: "savings", mask: "5678" },
    ]);

    const response = await POST(
      makeRequest({
        publicToken: "public-tok",
        organizationId: "org-1",
        linkedAccounts: { acc_plaid_123: "ledger-old" },
      }),
    );

    expect(response.status).toBe(200);
    expect(tables.accounts.update).toHaveBeenCalledWith({ external_account_id: "acc_plaid_123" });
    expect(tables.accounts.eq).toHaveBeenCalledWith("id", "ledger-old");
    expect(tables.accounts.insert).toHaveBeenCalledWith([
      expect.objectContaining({ external_account_id: "acc_plaid_456" }),
    ]);
  });

  it("refuses a link to an account outside the organization, before exchanging the token", async () => {
    const { client } = createSupabaseMock({
      user: { id: "user-1" },
      tables: { organization_members: { select: ok({ role: "owner" }) }, accounts: { select: ok([]) } },
    });
    serverClientMock.mockResolvedValue(client);

    const response = await POST(
      makeRequest({ publicToken: "public-tok", organizationId: "org-1", linkedAccounts: { acc_plaid_123: "elsewhere" } }),
    );

    expect(response.status).toBe(400);
    expect(exchangePublicTokenMock).not.toHaveBeenCalled();
  });

  it("skips creating accounts when Plaid returns none", async () => {
    const { client, tables } = createSupabaseMock({
      user: { id: "user-1" },
      tables: {
        organization_members: { select: ok({ role: "owner" }) },
        enrollments: { insert: ok(null) },
      },
    });
    serverClientMock.mockResolvedValue(client);
    getAccountsMock.mockResolvedValue([]);

    const response = await POST(
      makeRequest({ publicToken: "public-tok", organizationId: "org-1" }),
    );

    expect(response.status).toBe(200);
    expect(client.from).not.toHaveBeenCalledWith("accounts");
    expect(tables.accounts).toBeUndefined();
  });

  describe("duplicate guard", () => {
    function mockWithExisting(existingMasks: string[]) {
      const { client, tables } = createSupabaseMock({
        user: { id: "user-1" },
        tables: {
          organization_members: { select: ok({ role: "owner" }) },
          enrollments: { select: ok([{ account_masks: existingMasks }]), insert: ok(null) },
          accounts: { insert: ok([{ id: "ledger-1", external_account_id: "acc_plaid_123" }]) },
        },
      });
      serverClientMock.mockResolvedValue(client);
      return tables;
    }

    it("refuses an account that's already connected, before exchanging the token", async () => {
      const tables = mockWithExisting(["1234"]);

      const response = await POST(
        makeRequest({
          publicToken: "public-tok",
          organizationId: "org-1",
          institutionId: "ins_3",
          accountMasks: ["1234"],
        }),
      );

      expect(response.status).toBe(409);
      expect(exchangePublicTokenMock).not.toHaveBeenCalled();
      expect(tables.enrollments.eq).toHaveBeenCalledWith("institution_id", "ins_3");
      expect(tables.enrollments.neq).toHaveBeenCalledWith("status", "disconnected");
    });

    it("allows a different account at the same bank and records institution + masks from Plaid", async () => {
      const tables = mockWithExisting(["9999"]);
      getAccountsMock.mockResolvedValue([
        { id: "acc_plaid_123", name: "Checking", type: "depository", subtype: "checking", mask: "1234" },
      ]);

      const response = await POST(
        makeRequest({
          publicToken: "public-tok",
          organizationId: "org-1",
          institutionId: "ins_3",
          accountMasks: ["1234"],
        }),
      );

      expect(response.status).toBe(200);
      expect(tables.enrollments.insert).toHaveBeenCalledWith(
        expect.objectContaining({ institution_id: "ins_3", account_masks: ["1234"] }),
      );
    });
  });
});
