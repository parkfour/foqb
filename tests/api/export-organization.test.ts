import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, ok } from "./supabase-mock";

const { serverClientMock, getCurrentOrgIdMock, getCurrentUserRoleMock } = vi.hoisted(() => ({
  serverClientMock: vi.fn(),
  getCurrentOrgIdMock: vi.fn(),
  getCurrentUserRoleMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: serverClientMock }));
vi.mock("@/lib/org/current", () => ({
  getCurrentOrgId: getCurrentOrgIdMock,
  getCurrentUserRole: getCurrentUserRoleMock,
}));

import { GET } from "@/app/api/export/organization/route";

function emptyTables() {
  return {
    organizations: { select: ok({ id: "org-1", name: "Test Org" }) },
    accounts: { select: ok([{ id: "acc-1", name: "Cash" }]) },
    journal_entries: { select: ok([]) },
    customers: { select: ok([]) },
    vendors: { select: ok([]) },
    invoices: { select: ok([]) },
    bills: { select: ok([]) },
    invoice_payments: { select: ok([]) },
    bill_payments: { select: ok([]) },
    items: { select: ok([]) },
    inventory_items: { select: ok([]) },
    fixed_assets: { select: ok([]) },
    recurring_invoices: { select: ok([]) },
    recurring_bills: { select: ok([]) },
    bank_transactions: { select: ok([]) },
    bank_reconciliations: { select: ok([]) },
    categorization_rules: { select: ok([]) },
    enrollments: {
      select: ok([
        {
          id: "enr-1",
          organization_id: "org-1",
          institution_name: "Test Bank",
          status: "active",
        },
      ]),
    },
  };
}

describe("GET /api/export/organization", () => {
  beforeEach(() => {
    serverClientMock.mockReset();
    getCurrentOrgIdMock.mockReset();
    getCurrentUserRoleMock.mockReset();
  });

  it("returns 404 when there's no current organization", async () => {
    getCurrentOrgIdMock.mockResolvedValue(null);

    const response = await GET();
    expect(response.status).toBe(404);
  });

  it("returns 403 for a non-owner", async () => {
    getCurrentOrgIdMock.mockResolvedValue("org-1");
    getCurrentUserRoleMock.mockResolvedValue("accountant");

    const response = await GET();
    expect(response.status).toBe(403);
  });

  it("returns a JSON snapshot for the owner, excluding enrollment secrets", async () => {
    getCurrentOrgIdMock.mockResolvedValue("org-1");
    getCurrentUserRoleMock.mockResolvedValue("owner");

    const { client } = createSupabaseMock({ tables: emptyTables() });
    serverClientMock.mockResolvedValue(client);

    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toContain("foqb-backup-org-1.json");

    const body = (await response.json()) as {
      organization: unknown;
      accounts: unknown[];
      enrollments: Record<string, unknown>[];
    };
    expect(body.organization).toEqual({ id: "org-1", name: "Test Org" });
    expect(body.accounts).toEqual([{ id: "acc-1", name: "Cash" }]);
    expect(body.enrollments[0]).not.toHaveProperty("access_token");
    expect(body.enrollments[0]).not.toHaveProperty("cursor");
  });
});
