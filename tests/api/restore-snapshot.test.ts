import { describe, expect, it } from "vitest";
import { validateOrganizationSnapshot } from "@/lib/org/restore-snapshot";

function wellFormedSnapshot() {
  return {
    organization: { id: "org-1", name: "Test Org" },
    accounts: [],
    journal_entries: [],
    customers: [],
    vendors: [],
    invoices: [],
    bills: [],
    invoice_payments: [],
    bill_payments: [],
    items: [],
    inventory_items: [],
    fixed_assets: [],
    recurring_invoices: [],
    recurring_bills: [],
    bank_transactions: [],
    bank_reconciliations: [],
    categorization_rules: [],
  };
}

describe("validateOrganizationSnapshot", () => {
  it("accepts a well-formed snapshot", () => {
    const result = validateOrganizationSnapshot(wellFormedSnapshot());
    expect(result.valid).toBe(true);
  });

  it("rejects non-object input", () => {
    const result = validateOrganizationSnapshot("not an object");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toMatch(/doesn't look like/);
  });

  it("rejects an array", () => {
    const result = validateOrganizationSnapshot([1, 2, 3]);
    expect(result.valid).toBe(false);
  });

  it("rejects a missing organization key", () => {
    const snapshot: Record<string, unknown> = wellFormedSnapshot();
    delete snapshot.organization;
    const result = validateOrganizationSnapshot(snapshot);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toMatch(/organization details/);
  });

  it("rejects an organization missing id or name", () => {
    const result = validateOrganizationSnapshot({
      ...wellFormedSnapshot(),
      organization: { id: "org-1" },
    });
    expect(result.valid).toBe(false);
  });

  it("rejects a missing or malformed array section", () => {
    const snapshot = wellFormedSnapshot();
    // @ts-expect-error -- deliberately malformed for the test
    snapshot.accounts = "not an array";
    const result = validateOrganizationSnapshot(snapshot);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toMatch(/"accounts"/);
  });
});
