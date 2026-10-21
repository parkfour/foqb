import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, ok } from "./supabase-mock";

const { serverClientMock } = vi.hoisted(() => ({ serverClientMock: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({ createClient: serverClientMock }));

import { fetchApAging, fetchArAging, fetchCustomerInvoices, fetchVendorBills } from "@/lib/reports/aging";

const ASOF = "2026-06-01";

describe("fetchArAging", () => {
  beforeEach(() => {
    serverClientMock.mockReset();
  });

  it("buckets outstanding invoices by days overdue and excludes fully paid ones", async () => {
    const { client } = createSupabaseMock({
      tables: {
        invoices: {
          select: ok([
            {
              id: "inv-current",
              number: "INV-1",
              date: "2026-05-20",
              due_date: "2026-06-10", // not yet due
              party: { name: "Acme" },
              lines: [{ amount: 100 }],
              payments: [],
            },
            {
              id: "inv-45-days",
              number: "INV-2",
              date: "2026-03-01",
              due_date: "2026-04-17", // 45 days overdue -> 31-60
              party: { name: "Globex" },
              lines: [{ amount: 200 }],
              payments: [{ amount: 50 }],
            },
            {
              id: "inv-paid",
              number: "INV-3",
              date: "2026-04-01",
              due_date: "2026-04-15",
              party: { name: "Initech" },
              lines: [{ amount: 300 }],
              payments: [{ amount: 300 }],
            },
          ]),
        },
      },
    });
    serverClientMock.mockResolvedValue(client);

    const rows = await fetchArAging("org-1", ASOF);

    expect(rows.map((r) => r.id)).toEqual(["inv-45-days", "inv-current"]);

    const overdue = rows.find((r) => r.id === "inv-45-days")!;
    expect(overdue.remaining).toBe(150);
    expect(overdue.daysOverdue).toBe(45);
    expect(overdue.bucket).toBe("31-60");

    const current = rows.find((r) => r.id === "inv-current")!;
    expect(current.bucket).toBe("current");
  });

  it("includes tax_amount in the outstanding total", async () => {
    const { client } = createSupabaseMock({
      tables: {
        invoices: {
          select: ok([
            {
              id: "inv-taxed",
              number: "INV-4",
              date: "2026-05-01",
              due_date: "2026-05-15",
              tax_amount: 20,
              party: { name: "Acme" },
              lines: [{ amount: 100 }],
              payments: [{ amount: 50 }],
            },
          ]),
        },
      },
    });
    serverClientMock.mockResolvedValue(client);

    const rows = await fetchArAging("org-1", ASOF);
    expect(rows[0].remaining).toBe(70); // (100 + 20) - 50
  });
});

describe("fetchApAging", () => {
  beforeEach(() => {
    serverClientMock.mockReset();
  });

  it("buckets outstanding bills the same way, on the bills tables", async () => {
    const { client } = createSupabaseMock({
      tables: {
        bills: {
          select: ok([
            {
              id: "bill-95-days",
              number: "BILL-1",
              date: "2026-01-01",
              due_date: "2026-02-25", // 95 days overdue -> 90+
              party: { name: "Vendor Co" },
              lines: [{ amount: 500 }],
              payments: [],
            },
          ]),
        },
      },
    });
    serverClientMock.mockResolvedValue(client);

    const rows = await fetchApAging("org-1", ASOF);

    expect(rows).toHaveLength(1);
    expect(rows[0].bucket).toBe("90+");
    expect(rows[0].remaining).toBe(500);
    expect(rows[0].partyName).toBe("Vendor Co");
  });
});

describe("fetchCustomerInvoices", () => {
  beforeEach(() => {
    serverClientMock.mockReset();
  });

  it("includes every invoice regardless of status, unlike the aging report", async () => {
    const { client } = createSupabaseMock({
      tables: {
        invoices: {
          select: ok([
            {
              id: "inv-open",
              number: "INV-1",
              date: "2026-05-01",
              due_date: "2026-05-15",
              status: "open",
              lines: [{ amount: 100 }],
              payments: [],
            },
            {
              id: "inv-paid",
              number: "INV-2",
              date: "2026-04-01",
              due_date: "2026-04-15",
              status: "paid",
              lines: [{ amount: 200 }],
              payments: [{ amount: 200 }],
            },
          ]),
        },
      },
    });
    serverClientMock.mockResolvedValue(client);

    const rows = await fetchCustomerInvoices("org-1", "cust-1", ASOF);

    expect(rows).toHaveLength(2);
    const paid = rows.find((r) => r.id === "inv-paid")!;
    expect(paid.total).toBe(200);
    expect(paid.paid).toBe(200);
    expect(paid.remaining).toBe(0);
  });

  it("treats a void invoice as owing nothing even if never paid", async () => {
    const { client } = createSupabaseMock({
      tables: {
        invoices: {
          select: ok([
            {
              id: "inv-void",
              number: "INV-3",
              date: "2026-04-01",
              due_date: "2026-04-15",
              status: "void",
              lines: [{ amount: 300 }],
              payments: [],
            },
          ]),
        },
      },
    });
    serverClientMock.mockResolvedValue(client);

    const rows = await fetchCustomerInvoices("org-1", "cust-1", ASOF);

    expect(rows[0].total).toBe(300);
    expect(rows[0].remaining).toBe(0);
  });

  it("sorts newest first", async () => {
    const { client } = createSupabaseMock({
      tables: {
        invoices: {
          select: ok([
            { id: "old", number: "INV-OLD", date: "2026-01-01", due_date: "2026-01-15", status: "paid", lines: [{ amount: 1 }], payments: [{ amount: 1 }] },
            { id: "new", number: "INV-NEW", date: "2026-05-01", due_date: "2026-05-15", status: "open", lines: [{ amount: 1 }], payments: [] },
          ]),
        },
      },
    });
    serverClientMock.mockResolvedValue(client);

    const rows = await fetchCustomerInvoices("org-1", "cust-1", ASOF);
    expect(rows.map((r) => r.id)).toEqual(["new", "old"]);
  });
});

describe("fetchVendorBills", () => {
  beforeEach(() => {
    serverClientMock.mockReset();
  });

  it("includes every bill regardless of status", async () => {
    const { client } = createSupabaseMock({
      tables: {
        bills: {
          select: ok([
            {
              id: "bill-partial",
              number: "BILL-1",
              date: "2026-05-01",
              due_date: "2026-05-15",
              status: "partial",
              lines: [{ amount: 400 }],
              payments: [{ amount: 150 }],
            },
          ]),
        },
      },
    });
    serverClientMock.mockResolvedValue(client);

    const rows = await fetchVendorBills("org-1", "vend-1", ASOF);

    expect(rows[0].total).toBe(400);
    expect(rows[0].paid).toBe(150);
    expect(rows[0].remaining).toBe(250);
  });
});
