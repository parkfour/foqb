// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from "vitest";

const { checkInvoiceMock } = vi.hoisted(() => ({ checkInvoiceMock: vi.fn() }));
vi.mock("@/lib/plugins/server-loader", () => ({ checkInvoice: checkInvoiceMock, ensureServerPluginsLoaded: vi.fn() }));

import { createInvoice } from "@/lib/ar/create-invoice";
import { createSupabaseMock } from "./supabase-mock";

describe("createInvoice and the book's plugins' checks", () => {
  it("refuses before anything is posted, with the plugin's message", async () => {
    checkInvoiceMock.mockResolvedValue("This customer is reverse charge (VAT plugin): invoice them without VAT.");
    // No tables: any read or write would throw.
    const { client } = createSupabaseMock({ tables: {} });

    const result = await createInvoice(
      client as never,
      {
        organization_id: "org-1",
        customer_id: "c1",
        invoice_number: "INV-6",
        invoice_date: "2026-10-26",
        due_date: null,
        tax_rate: 19,
        lines: [{ item_id: null, account_id: "sales", description: "Consulting", quantity: 1, unit_price: 100 }],
      },
      "u1",
    );

    expect(result).toEqual({ error: "This customer is reverse charge (VAT plugin): invoice them without VAT.", status: 400 });
    expect(checkInvoiceMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      customerId: "c1",
      invoiceDate: "2026-10-26",
      subtotal: 100,
      taxAmount: 19,
      taxRateIds: [],
      lines: [{ account_id: "sales", amount: 100, item_id: null }],
    });
    expect(client.from).not.toHaveBeenCalled();
  });
});
