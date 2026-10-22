import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, ok } from "./supabase-mock";

const { serverClientMock } = vi.hoisted(() => ({ serverClientMock: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({ createClient: serverClientMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  categorizeBankTransaction,
  dismissBankChange,
  ignoreBankTransaction,
  ignoreTransactionAction,
  reopenBankTransaction,
} from "@/app/(dashboard)/transactions/actions";

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

describe("transaction actions", () => {
  beforeEach(() => {
    serverClientMock.mockReset();
  });

  it("only ignores a transaction that's still unreconciled", async () => {
    const { client, tables } = createSupabaseMock({
      tables: { bank_transactions: { update: ok(null) } },
    });
    serverClientMock.mockResolvedValue(client);

    await ignoreBankTransaction(formData({ id: "bt-1" }));

    expect(tables.bank_transactions.update).toHaveBeenCalledWith({ status: "ignored" });
    expect(tables.bank_transactions.eq).toHaveBeenCalledWith("id", "bt-1");
    expect(tables.bank_transactions.eq).toHaveBeenCalledWith("status", "unreconciled");
  });

  it("says so when there was no uncategorized transaction to ignore", async () => {
    const { client } = createSupabaseMock({
      tables: { bank_transactions: { update: ok([]) } },
    });
    serverClientMock.mockResolvedValue(client);

    expect(await ignoreTransactionAction("bt-1")).toEqual({
      success: false,
      error: "Only an uncategorized transaction can be ignored",
    });
  });

  it("ignores from the register", async () => {
    const { client } = createSupabaseMock({
      tables: { bank_transactions: { update: ok([{ id: "bt-1" }]) } },
    });
    serverClientMock.mockResolvedValue(client);

    expect(await ignoreTransactionAction("bt-1")).toEqual({ success: true });
  });

  it("categorizes by posting the entry and claiming the bank transaction in one RPC", async () => {
    const { client } = createSupabaseMock({
      tables: {
        bank_transactions: {
          select: ok({
            id: "bt-1",
            organization_id: "org-1",
            account_id: "bank-1",
            date: "2026-03-01",
            name: "Office supplies",
            amount: -30,
            status: "unreconciled",
          }),
        },
      },
      rpcs: { post_journal_entry: ok("entry-1") },
    });
    serverClientMock.mockResolvedValue(client);

    await categorizeBankTransaction(formData({ bankTransactionId: "bt-1", targetAccountId: "supplies" }));

    expect(client.rpc).toHaveBeenCalledWith("post_journal_entry", {
      p_org_id: "org-1",
      p_entry_date: "2026-03-01",
      p_memo: "Office supplies",
      p_lines: [
        { account_id: "supplies", debit: 30, credit: 0 },
        { account_id: "bank-1", debit: 0, credit: 30 },
      ],
      p_bank_transaction_id: "bt-1",
    });
  });

  it("re-opens a flagged transaction through reopen_bank_transaction", async () => {
    const { client } = createSupabaseMock({ tables: {}, rpcs: { reopen_bank_transaction: ok(null) } });
    serverClientMock.mockResolvedValue(client);

    await reopenBankTransaction(formData({ id: "bt-1" }));

    expect(client.rpc).toHaveBeenCalledWith("reopen_bank_transaction", { p_bank_transaction_id: "bt-1" });
  });

  it("dismisses a bank change by clearing only the flag", async () => {
    const { client, tables } = createSupabaseMock({ tables: { bank_transactions: { update: ok(null) } } });
    serverClientMock.mockResolvedValue(client);

    await dismissBankChange(formData({ id: "bt-1" }));

    expect(tables.bank_transactions.update).toHaveBeenCalledWith({ bank_change: null });
    expect(tables.bank_transactions.eq).toHaveBeenCalledWith("id", "bt-1");
  });
});
