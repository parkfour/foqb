import { describe, expect, it } from "vitest";
import { createSupabaseMock, ok } from "./supabase-mock";
import { importStatement } from "@/plugins/statement-import/import";

const statement = {
  bank: "Example",
  kind: "deposit" as const,
  accountName: "Brokerage",
  accountLast4: "1234",
  periodStart: "2026-01-01",
  periodEnd: "2026-01-31",
  openingBalance: 100,
  closingBalance: 110,
  rows: [{ date: "2026-01-31", description: "Change in value", amount: 10 }],
};

describe("importStatement", () => {
  it("adds nothing to an account already reconciled through the statement", async () => {
    const { client, tables } = createSupabaseMock({
      tables: {
        accounts: { select: ok({ id: "acc-1", type: "asset" }) },
        bank_reconciliations: { select: ok([{ statement_date: "2026-03-31" }]) },
      },
    });

    const result = await importStatement(client as never, "org-1", "user-1", "acc-1", statement);

    expect(result).toEqual({
      success: false,
      error: "This account is already reconciled through 2026-03-31, so this statement is in its books already. Nothing was added.",
    });
    expect(tables.bank_reconciliations.gte).toHaveBeenCalledWith("statement_date", "2026-01-31");
    expect(client.from).not.toHaveBeenCalledWith("bank_transactions");
  });
});
