import { describe, expect, it } from "vitest";
import { reconcileNagText, staleReconciliations } from "@/lib/reconcile/nag";

describe("staleReconciliations", () => {
  it("nags on the latest statement only, and only past 40 days", () => {
    const stale = staleReconciliations(
      [
        { account_id: "old", statement_date: "2026-09-30" },
        { account_id: "old", statement_date: "2026-08-31" },
        { account_id: "fresh", statement_date: "2026-07-31" },
        { account_id: "fresh", statement_date: "2026-10-31" },
        { account_id: "edge", statement_date: "2026-10-18" },
      ],
      "2026-11-27",
      40,
    );
    expect(stale.get("old")).toEqual({ days: 58, statementDate: "2026-09-30" });
    expect(stale.has("fresh")).toBe(false);
    expect(stale.has("edge")).toBe(false); // exactly 40 days: not yet
    expect(reconcileNagText(stale.get("old")!)).toBe("58 days since the last reconciled statement (2026-09-30)");
  });

  it("uses the book's own age", () => {
    const rows = [{ account_id: "a", statement_date: "2026-10-31" }];
    expect(staleReconciliations(rows, "2026-11-27", 25).has("a")).toBe(true);
    expect(staleReconciliations(rows, "2026-11-27", 30).has("a")).toBe(false);
  });
});
