import { afterEach, describe, expect, it, vi } from "vitest";

const { transactionsSyncMock, webhookVerificationKeyGetMock, linkTokenCreateMock } = vi.hoisted(() => ({
  transactionsSyncMock: vi.fn(),
  webhookVerificationKeyGetMock: vi.fn(),
  linkTokenCreateMock: vi.fn(),
}));

vi.mock("plaid", () => ({
  Configuration: vi.fn(),
  PlaidEnvironments: { sandbox: "https://sandbox.plaid.com" },
  PlaidApi: vi.fn(function () {
    return {
      transactionsSync: transactionsSyncMock,
      webhookVerificationKeyGet: webhookVerificationKeyGetMock,
      linkTokenCreate: linkTokenCreateMock,
    };
  }),
}));

import { createLinkToken, describePlaidError, getWebhookVerificationKey, syncTransactions } from "@/lib/plaid/client";

function tx(id: string, pending: boolean) {
  return { transaction_id: id, account_id: "acc-1", amount: 12.5, date: "2026-09-01", name: "Coffee", pending };
}

describe("syncTransactions", () => {
  it("drops pending transactions from added and modified, keeping removals", async () => {
    transactionsSyncMock.mockResolvedValue({
      data: {
        added: [tx("posted-1", false), tx("pending-1", true)],
        modified: [tx("pending-2", true), tx("posted-2", false)],
        removed: [{ transaction_id: "pending-0", account_id: "acc-1" }],
        next_cursor: "c2",
        has_more: false,
      },
    });

    const result = await syncTransactions("token", "c1");

    expect(result.added.map((t) => t.id)).toEqual(["posted-1"]);
    expect(result.modified.map((t) => t.id)).toEqual(["posted-2"]);
    expect(result.removed).toEqual([{ id: "pending-0", accountId: "acc-1" }]);
    expect(result.nextCursor).toBe("c2");
  });
});

describe("getWebhookVerificationKey", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("caches a key for a day, then refetches it (so a later expiry is seen)", async () => {
    vi.useFakeTimers();
    webhookVerificationKeyGetMock
      .mockResolvedValueOnce({ data: { key: { kid: "k1", expired_at: null } } })
      .mockResolvedValueOnce({ data: { key: { kid: "k1", expired_at: 1700000000 } } });

    expect((await getWebhookVerificationKey("k1")).expired_at).toBeNull();
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect((await getWebhookVerificationKey("k1")).expired_at).toBeNull();
    expect(webhookVerificationKeyGetMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect((await getWebhookVerificationKey("k1")).expired_at).toBe(1700000000);
    expect(webhookVerificationKeyGetMock).toHaveBeenCalledTimes(2);
  });
});

describe("createLinkToken", () => {
  it("asks for the maximum transaction history for a new Item", async () => {
    linkTokenCreateMock.mockResolvedValue({ data: { link_token: "link-1" } });

    await expect(createLinkToken("user-1")).resolves.toBe("link-1");
    expect(linkTokenCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        user: { client_user_id: "user-1" },
        products: ["transactions"],
        transactions: { days_requested: 730 },
      }),
    );
  });

  it("opens update mode for an existing Item: its access token, no new products or history", async () => {
    linkTokenCreateMock.mockReset();
    linkTokenCreateMock.mockResolvedValue({ data: { link_token: "link-2" } });

    await createLinkToken("user-1", "access-tok");

    const [request] = linkTokenCreateMock.mock.calls[0] as [Record<string, unknown>];
    expect(request.access_token).toBe("access-tok");
    expect(request).not.toHaveProperty("products");
    expect(request).not.toHaveProperty("transactions");
  });

  it("passes the OAuth redirect URI only when one is configured", async () => {
    linkTokenCreateMock.mockReset();
    linkTokenCreateMock.mockResolvedValue({ data: { link_token: "link-3" } });

    await createLinkToken("user-1");
    expect(linkTokenCreateMock.mock.calls[0][0]).not.toHaveProperty("redirect_uri");

    process.env.PLAID_REDIRECT_URI = "https://foqb.example/settings/bank-return";
    try {
      await createLinkToken("user-1", "access-tok");
      expect(linkTokenCreateMock.mock.calls[1][0]).toMatchObject({
        redirect_uri: "https://foqb.example/settings/bank-return",
      });
    } finally {
      delete process.env.PLAID_REDIRECT_URI;
    }
  });
});

describe("describePlaidError", () => {
  it("surfaces Plaid's error code and message from the HTTP error body", () => {
    const error = Object.assign(new Error("Request failed with status code 400"), {
      response: {
        data: {
          error_type: "INVALID_REQUEST",
          error_code: "INVALID_FIELD",
          error_message: "OAuth redirect URI must be configured in the developer dashboard",
          request_id: "req-1",
        },
      },
    });

    expect(describePlaidError(error)).toBe(
      "Plaid INVALID_REQUEST/INVALID_FIELD: OAuth redirect URI must be configured in the developer dashboard (request req-1)",
    );
  });

  it("falls back to the error message for non-Plaid errors", () => {
    expect(describePlaidError(new Error("socket hang up"))).toBe("socket hang up");
  });
});
