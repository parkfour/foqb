import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, ok } from "./supabase-mock";

const { serverClientMock } = vi.hoisted(() => ({ serverClientMock: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({ createClient: serverClientMock }));

import { fetchItemSales } from "@/lib/reports/item-sales";

describe("fetchItemSales", () => {
  beforeEach(() => {
    serverClientMock.mockReset();
  });

  it("maps invoice line rows to sale rows", async () => {
    const { client } = createSupabaseMock({
      tables: {
        invoice_lines: {
          select: ok([
            {
              quantity: 2,
              unit_price: 25,
              amount: 50,
              invoices: {
                id: "inv-1",
                invoice_number: "INV-1",
                invoice_date: "2026-05-01",
                status: "open",
                customers: { name: "Acme Co" },
              },
            },
          ]),
        },
      },
    });
    serverClientMock.mockResolvedValue(client);

    const rows = await fetchItemSales("item-1");

    expect(rows).toEqual([
      {
        invoiceId: "inv-1",
        invoiceNumber: "INV-1",
        date: "2026-05-01",
        customerName: "Acme Co",
        status: "open",
        quantity: 2,
        unitPrice: 25,
        amount: 50,
      },
    ]);
  });

  it("excludes lines on voided invoices", async () => {
    const { client } = createSupabaseMock({
      tables: {
        invoice_lines: {
          select: ok([
            {
              quantity: 1,
              unit_price: 10,
              amount: 10,
              invoices: {
                id: "inv-void",
                invoice_number: "INV-2",
                invoice_date: "2026-05-01",
                status: "void",
                customers: { name: "Acme Co" },
              },
            },
          ]),
        },
      },
    });
    serverClientMock.mockResolvedValue(client);

    const rows = await fetchItemSales("item-1");
    expect(rows).toEqual([]);
  });

  it("falls back to em-dash when the customer is missing", async () => {
    const { client } = createSupabaseMock({
      tables: {
        invoice_lines: {
          select: ok([
            {
              quantity: 1,
              unit_price: 10,
              amount: 10,
              invoices: {
                id: "inv-1",
                invoice_number: "INV-1",
                invoice_date: "2026-05-01",
                status: "open",
                customers: null,
              },
            },
          ]),
        },
      },
    });
    serverClientMock.mockResolvedValue(client);

    const rows = await fetchItemSales("item-1");
    expect(rows[0].customerName).toBe("—");
  });

  it("sorts newest first", async () => {
    const { client } = createSupabaseMock({
      tables: {
        invoice_lines: {
          select: ok([
            {
              quantity: 1,
              unit_price: 1,
              amount: 1,
              invoices: {
                id: "old",
                invoice_number: "INV-OLD",
                invoice_date: "2026-01-01",
                status: "open",
                customers: { name: "A" },
              },
            },
            {
              quantity: 1,
              unit_price: 1,
              amount: 1,
              invoices: {
                id: "new",
                invoice_number: "INV-NEW",
                invoice_date: "2026-05-01",
                status: "open",
                customers: { name: "B" },
              },
            },
          ]),
        },
      },
    });
    serverClientMock.mockResolvedValue(client);

    const rows = await fetchItemSales("item-1");
    expect(rows.map((r) => r.invoiceId)).toEqual(["new", "old"]);
  });
});
