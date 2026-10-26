import { describe, expect, it } from "vitest";
import { buildGeneralLedger, type TrialBalanceRow } from "@/lib/reports";

const tb = (id: string, type: TrialBalanceRow["type"], balance: number): TrialBalanceRow => ({
  account_id: id,
  account_number: id,
  name: id,
  type,
  total_debit: 0,
  total_credit: 0,
  balance,
});
const line = (account_id: string, debit: number, credit: number, entry_date = "2026-03-01") => ({
  account_id,
  entry_id: `${account_id}-${entry_date}`,
  entry_date,
  memo: null,
  description: null,
  debit,
  credit,
});

describe("buildGeneralLedger", () => {
  it("runs each account's balance on from its opening balance, in its normal direction", () => {
    const ledger = buildGeneralLedger(
      [tb("cash", "asset", 100), tb("card", "liability", 50), tb("idle", "expense", 0), tb("sales", "revenue", 0)],
      [line("cash", 30, 0), line("cash", 0, 10, "2026-03-02"), line("card", 0, 20), line("sales", 0, 30)],
    );

    expect(ledger.map((a) => a.account.account_id)).toEqual(["cash", "card", "sales"]);
    expect(ledger[0].lines.map((l) => l.balance)).toEqual([130, 120]);
    expect(ledger[0].closing).toBe(120);
    expect(ledger[1].closing).toBe(70);
    expect(ledger[2]).toMatchObject({ opening: 0, closing: 30 });
  });

  it("keeps an account with an opening balance but no activity", () => {
    const [only] = buildGeneralLedger([tb("land", "asset", 5000)], []);
    expect(only).toMatchObject({ opening: 5000, closing: 5000, lines: [] });
  });
});
