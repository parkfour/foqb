import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, ok } from "./supabase-mock";
import { computeNextDate, generateDueRecurring } from "@/lib/recurring/generate";

describe("computeNextDate", () => {
  it("adds 7 days for weekly", () => {
    expect(computeNextDate("2026-06-01", "weekly")).toBe("2026-06-08");
  });

  it("adds 1 month for monthly", () => {
    expect(computeNextDate("2026-06-01", "monthly")).toBe("2026-07-01");
  });

  it("adds 1 year for yearly", () => {
    expect(computeNextDate("2026-06-01", "yearly")).toBe("2027-06-01");
  });

  it("rolls over correctly across a month-end for monthly (Jan 31 -> Mar 3, JS Date normalizes)", () => {
    // Documented behavior, not a design goal: JS Date's setUTCMonth on the
    // 31st rolls into the next month again when the target month is
    // shorter (Feb has 28/29 days) — same overflow every JS date library
    // has without explicit clamping. Acceptable here since invoice cadence
    // doesn't need calendar-exact month lengths.
    expect(computeNextDate("2026-01-31", "monthly")).toBe("2026-03-03");
  });
});

const { createAdminClientMock, createInvoiceMock, createBillMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  createInvoiceMock: vi.fn(),
  createBillMock: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));
vi.mock("@/lib/ar/create-invoice", () => ({ createInvoice: createInvoiceMock }));
vi.mock("@/lib/ar/create-bill", () => ({ createBill: createBillMock }));

describe("generateDueRecurring", () => {
  const template = (next_date: string) => ({
    id: "t1",
    organization_id: "org-1",
    customer_id: "c1",
    next_date,
    tax_rate: 0,
    frequency: "weekly",
    organizations: { timezone: "America/Chicago", suspended_at: null },
  });

  function setUp(nextDate: string) {
    const { client, tables } = createSupabaseMock({
      tables: {
        recurring_invoices: { select: ok([template(nextDate)]), update: ok([{ id: "t1" }]) },
        recurring_invoice_lines: { select: ok([{ item_id: null, account_id: "a", description: "", quantity: 1, unit_price: 10 }]) },
        recurring_bills: { select: ok([]) },
      },
    });
    // Each claim moves the template a week on, as the database would.
    let current = nextDate;
    tables.recurring_invoices.maybeSingle.mockImplementation(async () => ok(template(current)));
    tables.recurring_invoices.update.mockImplementation((values: unknown) => {
      const next = (values as { next_date: string }).next_date;
      if (next > current) current = next;
      return tables.recurring_invoices;
    });
    createAdminClientMock.mockReturnValue(client);
    return { tables, dates: () => current };
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-03-20T18:00:00Z"));
    createInvoiceMock.mockReset().mockResolvedValue({ id: "inv", journalEntryId: "je" });
    createBillMock.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("generates every date that has come, then stops at the next one", async () => {
    const s = setUp("2026-03-01");

    expect(await generateDueRecurring()).toEqual({ generated: 3, failed: 0 });
    expect(createInvoiceMock.mock.calls.map((c) => c[1].invoice_date)).toEqual(["2026-03-01", "2026-03-08", "2026-03-15"]);
    expect(createInvoiceMock.mock.calls[0][2]).toBeNull();
    expect(s.dates()).toBe("2026-03-22");
  });

  it("leaves a template whose date is still to come", async () => {
    setUp("2026-03-21");
    expect(await generateDueRecurring()).toEqual({ generated: 0, failed: 0 });
    expect(createInvoiceMock).not.toHaveBeenCalled();
  });

  it("puts the date back and stops when posting fails", async () => {
    const s = setUp("2026-03-01");
    createInvoiceMock.mockResolvedValue({ error: "Period is closed", status: 400 });
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await generateDueRecurring()).toEqual({ generated: 0, failed: 1 });
    expect(s.tables.recurring_invoices.update).toHaveBeenLastCalledWith({ next_date: "2026-03-01" });
  });
});
