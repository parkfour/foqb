import { describe, expect, it } from "vitest";
import { formatAccountLabel } from "@/lib/accounts/format";

describe("formatAccountLabel", () => {
  it("prefixes the account number when codes are shown", () => {
    expect(formatAccountLabel({ account_number: "1000", name: "Cash" }, true)).toBe(
      "1000 — Cash",
    );
  });

  it("omits the number when codes are hidden", () => {
    expect(formatAccountLabel({ account_number: "1000", name: "Cash" }, false)).toBe("Cash");
  });

  it("falls back to just the name for synthetic rows with no account_number, even with codes shown", () => {
    expect(formatAccountLabel({ account_number: null, name: "Retained Earnings" }, true)).toBe(
      "Retained Earnings",
    );
  });
});
