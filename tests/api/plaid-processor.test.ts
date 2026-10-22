import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaidTransaction } from "@/lib/plaid/client";
import { createSupabaseMock, fail, ok } from "./supabase-mock";

const { createAdminClientMock } = vi.hoisted(() => ({ createAdminClientMock: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));

import { processBankTransactions, processRemovedTransactions } from "@/lib/plaid/processor";

function tx(overrides: Partial<PlaidTransaction> = {}): PlaidTransaction {
  return {
    id: "txn_1",
    account_id: "acc_plaid_1",
    // Plaid sign convention: positive = money out (expense).
    amount: 42.5,
    date: "2026-01-15",
    name: "COFFEE SHOP",
    ...overrides,
  };
}

describe("processBankTransactions", () => {
  beforeEach(() => {
    createAdminClientMock.mockReset();
  });

  function existingRow(row: { status: string; amount: number; date: string }) {
    const { client, tables } = createSupabaseMock({
      tables: {
        bank_transactions: { upsert: ok([]), select: ok({ id: "bt-1", ...row }), update: ok(null) },
      },
    });
    createAdminClientMock.mockReturnValue(client);
    return { client, tables };
  }

  it("takes over a row from the bank's earlier connection instead of recording it twice", async () => {
    const { client, tables } = existingRow({ status: "matched", amount: -42.5, date: "2026-01-15" });
    // Not known under the new id; an old-connection row has the same account, date and amount.
    tables.bank_transactions.maybeSingle
      .mockResolvedValueOnce(ok(null))
      .mockResolvedValueOnce(ok({ id: "bt-old" }));

    await processBankTransactions("org-1", "bank-account-1", [tx({ id: "txn_new", account_id: "acc_new" })]);

    expect(tables.bank_transactions.neq).toHaveBeenCalledWith("external_account_id", "acc_new");
    expect(tables.bank_transactions.update).toHaveBeenCalledWith({
      external_transaction_id: "txn_new",
      external_account_id: "acc_new",
    });
    expect(tables.bank_transactions.upsert).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("doesn't post a row the database matched to an already-booked transfer", async () => {
    const { client } = createSupabaseMock({
      tables: { bank_transactions: { upsert: ok([{ id: "bt-2", status: "matched" }]), select: ok(null) } },
    });
    createAdminClientMock.mockReturnValue(client);

    await processBankTransactions("org-1", "bank-account-1", [tx()]);

    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("applies Plaid's new details directly to an unreconciled transaction", async () => {
    const { client, tables } = existingRow({ status: "unreconciled", amount: -42.5, date: "2026-01-15" });

    await processBankTransactions("org-1", "bank-account-1", [
      tx({ amount: 45, name: "COFFEE SHOP #12", date: "2026-01-16" }),
    ]);

    expect(tables.bank_transactions.update).toHaveBeenCalledWith({
      date: "2026-01-16",
      name: "COFFEE SHOP #12",
      amount: -45,
    });
    expect(tables.bank_transactions.eq).toHaveBeenCalledWith("id", "bt-1");
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("holds a changed amount/date on a matched transaction for review, updating only the name", async () => {
    const { tables } = existingRow({ status: "matched", amount: -42.5, date: "2026-01-15" });

    await processBankTransactions("org-1", "bank-account-1", [
      tx({ amount: 45, name: "COFFEE SHOP #12", date: "2026-01-16" }),
    ]);

    expect(tables.bank_transactions.update).toHaveBeenCalledWith({
      name: "COFFEE SHOP #12",
      bank_change: { amount: -45, date: "2026-01-16" },
    });
  });

  it("clears the review flag when a matched transaction's amount/date match what was booked", async () => {
    const { tables } = existingRow({ status: "matched", amount: -42.5, date: "2026-01-15" });

    await processBankTransactions("org-1", "bank-account-1", [tx({ name: "COFFEE SHOP (renamed)" })]);

    expect(tables.bank_transactions.update).toHaveBeenCalledWith({
      name: "COFFEE SHOP (renamed)",
      bank_change: null,
    });
  });

  it("records the transaction first as unreconciled, sign-flipped to the internal convention", async () => {
    const { client, tables } = createSupabaseMock({
      tables: { bank_transactions: { upsert: ok([{ id: "bt-1" }]) } },
      rpcs: { match_bank_transaction: ok(null) },
    });
    createAdminClientMock.mockReturnValue(client);

    await processBankTransactions("org-1", "bank-account-1", [tx({ amount: 42.5 })]);

    expect(tables.bank_transactions.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: "org-1",
        account_id: "bank-account-1",
        external_transaction_id: "txn_1",
        status: "unreconciled",
        journal_entry_id: null,
        amount: -42.5,
      }),
      { onConflict: "external_transaction_id", ignoreDuplicates: true },
    );
    expect(client.rpc).not.toHaveBeenCalledWith("post_journal_entry", expect.anything());
  });

  it("posts a matched expense atomically (debit target, credit bank) and claims the bank transaction", async () => {
    const { client } = createSupabaseMock({
      tables: { bank_transactions: { upsert: ok([{ id: "bt-1" }]) } },
      rpcs: { match_bank_transaction: ok("expense-account-1"), post_journal_entry: ok("entry-1") },
    });
    createAdminClientMock.mockReturnValue(client);

    // Positive Plaid amount = expense.
    await processBankTransactions("org-1", "bank-account-1", [tx({ amount: 42.5 })]);

    expect(client.rpc).toHaveBeenCalledWith("match_bank_transaction", {
      p_org_id: "org-1",
      p_description: "COFFEE SHOP",
      p_amount: -42.5,
      p_bank_account_id: "bank-account-1",
    });
    expect(client.rpc).toHaveBeenCalledWith("post_journal_entry", {
      p_org_id: "org-1",
      p_entry_date: "2026-01-15",
      p_memo: "COFFEE SHOP",
      p_lines: [
        { account_id: "expense-account-1", debit: 42.5, credit: 0 },
        { account_id: "bank-account-1", debit: 0, credit: 42.5 },
      ],
      p_bank_transaction_id: "bt-1",
    });
  });

  it("posts matched income (debit bank, credit target)", async () => {
    const { client } = createSupabaseMock({
      tables: { bank_transactions: { upsert: ok([{ id: "bt-2" }]) } },
      rpcs: { match_bank_transaction: ok("revenue-account-1"), post_journal_entry: ok("entry-2") },
    });
    createAdminClientMock.mockReturnValue(client);

    // Negative Plaid amount = deposit/income.
    await processBankTransactions("org-1", "bank-account-1", [tx({ id: "txn_2", amount: -1500 })]);

    expect(client.rpc).toHaveBeenCalledWith(
      "post_journal_entry",
      expect.objectContaining({
        p_lines: [
          { account_id: "bank-account-1", debit: 1500, credit: 0 },
          { account_id: "revenue-account-1", debit: 0, credit: 1500 },
        ],
      }),
    );
  });

  it("leaves the transaction unreconciled (no partial entry) when posting fails", async () => {
    const { client, tables } = createSupabaseMock({
      tables: { bank_transactions: { upsert: ok([{ id: "bt-3" }]) } },
      rpcs: { match_bank_transaction: ok("expense-account-1"), post_journal_entry: fail("period locked") },
    });
    createAdminClientMock.mockReturnValue(client);

    await processBankTransactions("org-1", "bank-account-1", [tx({ id: "txn_3" })]);

    // Nothing to clean up: the RPC is one transaction, and the bank
    // transaction row stays as recorded.
    expect(tables.bank_transactions.delete).not.toHaveBeenCalled();
    expect(tables.bank_transactions.update).not.toHaveBeenCalled();
  });

  it("throws when the transaction can't be recorded, so the sync cursor isn't advanced", async () => {
    const { client } = createSupabaseMock({
      tables: { bank_transactions: { upsert: fail("connection reset") } },
    });
    createAdminClientMock.mockReturnValue(client);

    await expect(
      processBankTransactions("org-1", "bank-account-1", [tx({ id: "txn_5" })]),
    ).rejects.toThrow(/txn_5: connection reset/);
  });

  it("leaves the transaction unreconciled when match_bank_transaction errors", async () => {
    const { client } = createSupabaseMock({
      tables: { bank_transactions: { upsert: ok([{ id: "bt-4" }]) } },
      rpcs: { match_bank_transaction: fail("function error") },
    });
    createAdminClientMock.mockReturnValue(client);

    await processBankTransactions("org-1", "bank-account-1", [tx({ id: "txn_4" })]);

    expect(client.rpc).not.toHaveBeenCalledWith("post_journal_entry", expect.anything());
  });
});

describe("processRemovedTransactions", () => {
  beforeEach(() => {
    createAdminClientMock.mockReset();
  });

  it("deletes the bank transaction and its journal entry when both exist", async () => {
    const { client, tables } = createSupabaseMock({
      tables: {
        bank_transactions: {
          select: ok({ id: "bank-tx-1", journal_entry_id: "entry-1" }),
          delete: ok(null),
        },
        journal_entries: { delete: ok(null) },
      },
    });
    createAdminClientMock.mockReturnValue(client);

    await processRemovedTransactions([{ id: "txn_removed" }]);

    expect(tables.bank_transactions.delete).toHaveBeenCalled();
    expect(tables.journal_entries.delete).toHaveBeenCalled();
  });

  it("does nothing when the transaction was never synced", async () => {
    const { client, tables } = createSupabaseMock({
      tables: { bank_transactions: { select: ok(null) } },
    });
    createAdminClientMock.mockReturnValue(client);

    await processRemovedTransactions([{ id: "txn_unknown" }]);

    expect(tables.bank_transactions.delete).not.toHaveBeenCalled();
  });
});
