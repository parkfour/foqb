import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, ok } from "./supabase-mock";

const { serverClientMock } = vi.hoisted(() => ({ serverClientMock: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({ createClient: serverClientMock }));

import { fetchBeginningBalance, fetchUnclearedLines } from "@/lib/reconcile";
import { signedAmount } from "@/lib/reconcile/shared";

describe("signedAmount", () => {
  it("treats debit as increasing an asset balance", () => {
    expect(signedAmount("asset", 100, 40)).toBe(60);
  });

  it("treats credit as increasing a liability balance", () => {
    expect(signedAmount("liability", 40, 100)).toBe(60);
  });
});

describe("fetchBeginningBalance", () => {
  beforeEach(() => {
    serverClientMock.mockReset();
  });

  it("sums already-cleared lines for the account under the asset sign convention", async () => {
    const { client } = createSupabaseMock({
      tables: {
        journal_lines: {
          select: ok([
            { debit: 200, credit: 0 },
            { debit: 0, credit: 50 },
          ]),
        },
      },
    });
    serverClientMock.mockResolvedValue(client);

    const balance = await fetchBeginningBalance("acct-1", "asset", "recon-current");
    expect(balance).toBe(150);
  });
});

describe("fetchUnclearedLines", () => {
  beforeEach(() => {
    serverClientMock.mockReset();
  });

  it("maps joined journal_entries fields onto each line", async () => {
    const { client } = createSupabaseMock({
      tables: {
        journal_lines: {
          select: ok([
            {
              id: "l1",
              description: "Deposit",
              debit: 200,
              credit: 0,
              journal_entries: { entry_date: "2026-06-01", memo: "June deposit" },
            },
          ]),
        },
      },
    });
    serverClientMock.mockResolvedValue(client);

    const lines = await fetchUnclearedLines("acct-1", "2026-06-30");
    expect(lines).toEqual([
      {
        id: "l1",
        entryDate: "2026-06-01",
        memo: "June deposit",
        description: "Deposit",
        debit: 200,
        credit: 0,
      },
    ]);
  });
});
