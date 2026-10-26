// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const { enabledIds, processBankTransactionsMock, addLedgerAccountsMock, linking } = vi.hoisted(() => ({
  enabledIds: { value: [] as string[] },
  linking: { blocked: null as string | null },
  processBankTransactionsMock: vi.fn(),
  addLedgerAccountsMock: vi.fn(),
}));
vi.mock("@/lib/plugins/settings", () => ({ getOrgEnabledPluginIds: async () => enabledIds.value }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/plaid/processor", () => ({ processBankTransactions: processBankTransactionsMock }));
vi.mock("@/lib/plaid/ledger-accounts", () => ({ addLedgerAccounts: addLedgerAccountsMock }));
vi.mock("@/lib/plaid/bank-linking", () => ({ bankLinkingBlockedReason: async () => linking.blocked }));
vi.mock("@/lib/bank/transfers", () => ({ bookPendingTransfers: vi.fn() }));
vi.mock("@/lib/bank/opening-balance", () => ({ bookOpeningBalances: vi.fn() }));

import { checkInvoice, enabledPluginJobs, invoiceNotes, sendBookMail } from "@/lib/plugins/server-loader";
import { ingestBankFeed } from "@/lib/bank/plugin-feed";
import { findPluginReport, pluginReportOptions } from "@/lib/plugins/pages";
import { vatNotes, vatRefusal } from "@/plugins/eu-vat/server";
import type { FOQBPlugin, InvoiceCheckInput, ServerPluginParts } from "@/lib/plugins/types";

const admin = {} as SupabaseClient;
const invoice: InvoiceCheckInput = {
  organizationId: "org-1",
  customerId: "cust-1",
  invoiceDate: "2026-10-26",
  subtotal: 100,
  taxAmount: 19,
  taxRateIds: ["vat"],
  lines: [{ account_id: "sales", amount: 100 }],
};

beforeEach(() => {
  enabledIds.value = [];
  linking.blocked = null;
  vi.clearAllMocks();
});

describe("book-scoped plugin parts", () => {
  const parts: Record<string, ServerPluginParts> = {
    vat: {
      invoiceNotes: async () => ["VAT number: DE123456789", " "],
      invoiceChecks: [async (_a, i) => (i.taxAmount > 0 ? "No VAT for this customer" : null)],
    },
    broken: {
      invoiceNotes: async () => {
        throw new Error("down");
      },
      invoiceChecks: [
        async () => {
          throw new Error("down");
        },
      ],
    },
  };

  it("asks only the plugins on in the book, and passes over one that fails", async () => {
    expect(await invoiceNotes(admin, { id: "inv", organizationId: "org-1", customerId: null }, parts)).toEqual([]);
    expect(await checkInvoice(invoice, parts)).toBeNull();

    enabledIds.value = ["broken", "vat"];
    expect(await invoiceNotes(admin, { id: "inv", organizationId: "org-1", customerId: null }, parts)).toEqual(["VAT number: DE123456789"]);
    expect(await checkInvoice(invoice, parts)).toBe("No VAT for this customer");
    expect(await checkInvoice({ ...invoice, taxAmount: 0 }, parts)).toBeNull();
  });

  it("sends book mail through the first mailer that's set up, or says why not", async () => {
    const send = vi.fn();
    const mailParts: Record<string, ServerPluginParts> = {
      unset: { mailer: { ready: async () => false, send: vi.fn() } },
      smtp: { mailer: { ready: async () => true, send } },
    };
    const mail = { to: "ann@example.test", subject: "Hi", text: "Hello" };
    expect(await sendBookMail(admin, "org-1", mail, mailParts)).toMatchObject({ sent: false });

    enabledIds.value = ["unset", "smtp"];
    expect(await sendBookMail(admin, "org-1", mail, mailParts)).toEqual({ sent: true });
    expect(send).toHaveBeenCalledWith("org-1", mail);
  });

  it("runs a plugin's bank feed as a job of its own", () => {
    const parts: Record<string, ServerPluginParts> = { gc: { bankFeed: { name: "GoCardless", minIntervalSeconds: 3600, fetch: async () => [] } } };
    expect(enabledPluginJobs(["gc"], parts).map((j) => [j.name, j.minIntervalSeconds])).toEqual([["gc-bank-feed", 3600]]);
  });
});

describe("ingestBankFeed", () => {
  it("adds a ledger account for a new bank account and books its rows in the processor's sign", async () => {
    // The ledger lookup finds nothing, then the account just added.
    const lookups = [[], [{ id: "ledger-1", type: "asset", external_account_id: "gc:acct-1" }]];
    const supabase = {
      from: () => ({
        select: () => ({ eq: () => ({ in: async () => ({ data: lookups.shift(), error: null }) }) }),
        update: () => ({ eq: async () => ({ error: null }) }),
      }),
    };
    addLedgerAccountsMock.mockResolvedValue(null);

    const booked = await ingestBankFeed(supabase as unknown as SupabaseClient, "gc", "org-1", [
      { id: "acct-1", name: "Girokonto", kind: "asset", balance: 120, transactions: [{ id: "t1", date: "2026-10-20", name: "REWE", amount: -30 }] },
    ]);

    expect(booked).toBe(1);
    expect(addLedgerAccountsMock).toHaveBeenCalledWith(supabase, "org-1", [{ id: "gc:acct-1", name: "Girokonto", mask: null, type: "depository" }]);
    expect(processBankTransactionsMock).toHaveBeenCalledWith("org-1", "ledger-1", [
      { id: "gc:t1", account_id: "gc:acct-1", date: "2026-10-20", name: "REWE", amount: 30 },
    ]);
  });
});

describe("ingestBankFeed, other cases", () => {
  const updates: object[] = [];
  const known = (type: string) => ({
    from: () => ({
      select: () => ({ eq: () => ({ in: async () => ({ data: [{ id: "ledger-9", type, external_account_id: "gc:card" }], error: null }) }) }),
      update: (row: object) => ({ eq: async () => (updates.push(row), { error: null }) }),
    }),
  });

  it("books into the account it already made, without adding one, and records the balance", async () => {
    updates.length = 0;
    await ingestBankFeed(known("liability") as unknown as SupabaseClient, "gc", "org-1", [
      { id: "card", name: "Visa", kind: "liability", balance: 250, available: 750, transactions: [{ id: "t9", date: "2026-10-21", name: "AMZN", amount: -12.5 }] },
    ]);
    expect(addLedgerAccountsMock).not.toHaveBeenCalled();
    expect(processBankTransactionsMock).toHaveBeenCalledWith("org-1", "ledger-9", [
      { id: "gc:t9", account_id: "gc:card", date: "2026-10-21", name: "AMZN", amount: 12.5 },
    ]);
    expect(updates).toEqual([{ bank_balance: 250, bank_available: 750, bank_balance_at: expect.any(String) }]);
  });

  it("refuses a book that doesn't allow connecting banks, booking nothing", async () => {
    linking.blocked = "Connecting banks is turned off for this organization.";
    await expect(
      ingestBankFeed(known("asset") as unknown as SupabaseClient, "gc", "org-1", [{ id: "card", name: "Visa", kind: "asset", transactions: [] }]),
    ).rejects.toThrow("turned off");
    expect(processBankTransactionsMock).not.toHaveBeenCalled();
  });

  it("does nothing for an empty fetch", async () => {
    expect(await ingestBankFeed(known("asset") as unknown as SupabaseClient, "gc", "org-1", [])).toBe(0);
  });
});

describe("book mail, other cases", () => {
  it("says whether the book can send, and lets a mailer's failure through to the caller", async () => {
    const { bookCanSendMail } = await import("@/lib/plugins/server-loader");
    const parts: Record<string, ServerPluginParts> = {
      smtp: {
        mailer: {
          ready: async () => true,
          send: async () => {
            throw new Error("550 mailbox unavailable");
          },
        },
      },
    };
    expect(await bookCanSendMail(admin, "org-1", parts)).toBe(false);
    enabledIds.value = ["smtp"];
    expect(await bookCanSendMail(admin, "org-1", parts)).toBe(true);
    await expect(sendBookMail(admin, "org-1", { to: "a@example.test", subject: "s", text: "t" }, parts)).rejects.toThrow("550");
  });
});

describe("EU VAT invoice hooks", () => {
  const settings = { country: "DE", vatNumber: "DE123456789", outputAccountId: "", inputAccountId: "" };
  const rc = { "cust-1": { vatNumber: "FR12345678901" } };

  it("prints the seller's VAT number, and the reverse-charge wording for a reverse-charge customer", () => {
    expect(vatNotes(settings, rc, "cust-2")).toEqual(["VAT number: DE123456789"]);
    expect(vatNotes(settings, rc, "cust-1")).toEqual([
      "VAT number: DE123456789",
      "Customer VAT number: FR12345678901",
      expect.stringMatching(/^Reverse charge/),
    ]);
    expect(vatNotes(null, {}, "cust-1")).toEqual([]);
  });

  it("refuses VAT on a reverse-charge customer's invoice", () => {
    expect(vatRefusal(rc, invoice)).toMatch(/reverse charge/);
    expect(vatRefusal(rc, { ...invoice, taxAmount: 0 })).toBeNull();
    expect(vatRefusal(rc, { ...invoice, customerId: "cust-2" })).toBeNull();
  });
});

describe("plugin reports", () => {
  const Report = () => null;
  const plugins = [
    {
      manifest: { id: "vat", name: "VAT", version: "1", description: "" },
      reports: [
        { id: "summary", title: "VAT summary", range: true, workspace: "business", component: Report },
        { id: "Bad Id", title: "Skipped", range: false, component: Report },
      ],
    },
  ] as FOQBPlugin[];

  it("lists an enabled plugin's reports for the book's kind", () => {
    expect(pluginReportOptions("business", ["vat"], plugins)).toEqual([{ value: "plugin:vat:summary", label: "VAT summary", range: true }]);
    expect(pluginReportOptions("household", ["vat"], plugins)).toEqual([]);
    expect(pluginReportOptions("business", [], plugins)).toEqual([]);
    expect(findPluginReport("plugin:vat:summary", plugins)?.title).toBe("VAT summary");
  });
});
