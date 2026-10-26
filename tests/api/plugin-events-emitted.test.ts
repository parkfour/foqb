// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// Each event in docs/PLUGINS.md fires on every path that makes its change;
// one test per path, plus the case where the change fails and nothing fires.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createSupabaseMock, fail, ok } from "./supabase-mock";

const { emitHookMock, current, createInvoiceMock } = vi.hoisted(() => ({
  emitHookMock: vi.fn(),
  current: { client: null as unknown },
  createInvoiceMock: vi.fn(),
}));

vi.mock("@/lib/plugins/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/plugins/hooks")>()),
  emitHook: emitHookMock,
}));
vi.mock("@/lib/plugins/server-loader", () => ({ ensureServerPluginsLoaded: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => current.client }));
vi.mock("@/lib/org/current", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/org/current")>()),
  getCurrentOrgId: async () => "org-1",
}));
vi.mock("@/lib/org/control-accounts", () => ({ findAccountsReceivableAccount: async () => ({ id: "ar" }) }));
vi.mock("@/lib/ar/create-invoice", () => ({ createInvoice: createInvoiceMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));

import { createCustomer, voidInvoice } from "@/app/(dashboard)/customers/actions";
import { createVendor, voidBill } from "@/app/(dashboard)/vendors/actions";
import { POST as importCustomers } from "@/app/api/import/customers/route";
import { POST as importVendors } from "@/app/api/import/vendors/route";
import { POST as createEstimate } from "@/app/api/estimates/route";
import { convertEstimateToInvoice, setEstimateStatus } from "@/app/(dashboard)/customers/estimates/actions";
import { applyCreditMemo, createCreditMemo } from "@/app/(dashboard)/customers/credit-memos/actions";

type Mock = Parameters<typeof createSupabaseMock>[0];
const useClient = (config: Mock) => {
  const mock = createSupabaseMock(config);
  current.client = mock.client;
  return mock;
};
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const csvRequest = (path: string, csv: string) => {
  const f = new FormData();
  f.set("file", new File([csv], "import.csv", { type: "text/csv" }));
  return new NextRequest(`http://localhost${path}`, { method: "POST", body: f });
};
const emitted = () => emitHookMock.mock.calls.map(([event, payload]) => [event, payload]);

beforeEach(() => {
  emitHookMock.mockReset();
  createInvoiceMock.mockReset();
});

describe("voiding", () => {
  it("fires invoice:voided once void_invoice succeeds, and not when it's refused", async () => {
    useClient({ tables: { invoices: { select: ok({ invoice_number: "INV-3", organization_id: "org-1" }) } }, rpc: ok(null) });
    await voidInvoice({ error: null }, form({ id: "inv-3" }));
    expect(emitted()).toEqual([["invoice:voided", { invoiceId: "inv-3", invoiceNumber: "INV-3", orgId: "org-1" }]]);

    emitHookMock.mockReset();
    useClient({ tables: {}, rpc: fail("It's reconciled") });
    expect(await voidInvoice({ error: null }, form({ id: "inv-3" }))).toEqual({ error: "It's reconciled" });
    expect(emitted()).toEqual([]);
  });

  it("fires bill:voided", async () => {
    useClient({ tables: { bills: { select: ok({ bill_number: "B-100", organization_id: "org-1" }) } }, rpc: ok(null) });
    await voidBill({ error: null }, form({ id: "bill-1" }));
    expect(emitted()).toEqual([["bill:voided", { billId: "bill-1", billNumber: "B-100", orgId: "org-1" }]]);
  });
});

describe("customers and vendors", () => {
  it("fires customer:created from the form", async () => {
    useClient({ tables: { customers: { insert: ok({ id: "c1" }) } } });
    await expect(createCustomer({ error: null }, form({ organizationId: "org-1", name: "Ann Buyer", email: "ann@example.test" }))).rejects.toThrow("redirect:/customers");
    expect(emitted()).toEqual([["customer:created", { customerId: "c1", name: "Ann Buyer", email: "ann@example.test", orgId: "org-1" }]]);
  });

  it("fires nothing when the customer isn't saved", async () => {
    useClient({ tables: { customers: { insert: fail("duplicate") } } });
    expect(await createCustomer({ error: null }, form({ organizationId: "org-1", name: "Ann Buyer" }))).toEqual({ error: "duplicate" });
    expect(emitted()).toEqual([]);
  });

  it("fires vendor:created from the form", async () => {
    useClient({ tables: { vendors: { insert: ok({ id: "v1" }) } } });
    await expect(createVendor({ error: null }, form({ organizationId: "org-1", name: "Widget Supply" }))).rejects.toThrow("redirect:/vendors");
    expect(emitted()).toEqual([["vendor:created", { vendorId: "v1", name: "Widget Supply", email: null, orgId: "org-1" }]]);
  });

  it("fires customer:created for each row a CSV import adds", async () => {
    useClient({ tables: { customers: { select: ok([{ name: "Existing" }]), insert: ok({ id: "c1" }) } } });
    const res = await importCustomers(csvRequest("/api/import/customers", "name,email\nAnn,ann@example.test\nExisting,\nBob,\n"));
    expect((await res.json()).imported).toBe(2);
    expect(emitted().map(([event, p]) => [event, (p as { name: string }).name])).toEqual([
      ["customer:created", "Ann"],
      ["customer:created", "Bob"],
    ]);
  });

  it("fires vendor:created for each row a CSV import adds", async () => {
    useClient({ tables: { vendors: { select: ok([]), insert: ok({ id: "v1" }) } } });
    await importVendors(csvRequest("/api/import/vendors", "name\nWidget Supply\n"));
    expect(emitted()).toEqual([["vendor:created", { vendorId: "v1", name: "Widget Supply", email: null, orgId: "org-1" }]]);
  });
});

describe("estimates", () => {
  const body = {
    organization_id: "org-1",
    customer_id: "c1",
    estimate_number: "EST-1",
    estimate_date: "2026-10-26",
    expiry_date: null,
    lines: [{ item_id: null, account_id: "sales", description: "Widget", quantity: 2, unit_price: 10.005 }],
  };
  const post = (b: object) => createEstimate(new NextRequest("http://localhost/api/estimates", { method: "POST", body: JSON.stringify(b) }));

  it("fires estimate:created with the subtotal, and not when its lines fail", async () => {
    useClient({ user: { id: "u1" }, tables: { estimates: { insert: ok(null), delete: ok(null) }, estimate_lines: { insert: ok(null) } } });
    const res = await post(body);
    const { id } = await res.json();
    expect(emitted()).toEqual([["estimate:created", { estimateId: id, estimateNumber: "EST-1", customerId: "c1", subtotal: 20.01, orgId: "org-1" }]]);

    emitHookMock.mockReset();
    useClient({ user: { id: "u1" }, tables: { estimates: { insert: ok(null), delete: ok(null) }, estimate_lines: { insert: fail("bad line") } } });
    expect((await post(body)).status).toBe(400);
    expect(emitted()).toEqual([]);
  });

  it("fires estimate:status_changed when the status changes, not when it was already that", async () => {
    useClient({ tables: { estimates: { update: ok([{ estimate_number: "EST-1" }]) } } });
    await setEstimateStatus(form({ id: "est-1", status: "accepted" }));
    expect(emitted()).toEqual([
      ["estimate:status_changed", { estimateId: "est-1", estimateNumber: "EST-1", status: "accepted", invoiceId: null, orgId: "org-1" }],
    ]);

    emitHookMock.mockReset();
    useClient({ tables: { estimates: { update: ok([]) } } });
    await setEstimateStatus(form({ id: "est-1", status: "accepted" }));
    expect(emitted()).toEqual([]);
  });

  it("fires estimate:status_changed with the invoice when it's turned into one, and not when the invoice fails", async () => {
    const estimate = { customer_id: "c1", estimate_number: "EST-1", status: "accepted", tax_rate: 0, tax_rate_ids: [], estimate_lines: [] };
    useClient({ user: { id: "u1" }, tables: { estimates: { select: ok(estimate), update: ok([{ id: "est-1" }]) } } });
    createInvoiceMock.mockResolvedValue({ id: "inv-9", journalEntryId: "je-9" });
    await expect(convertEstimateToInvoice({ error: null }, form({ id: "est-1", invoiceNumber: "INV-9", invoiceDate: "2026-10-26" }))).rejects.toThrow(
      "redirect:/customers/invoices/inv-9",
    );
    expect(emitted()).toEqual([
      ["estimate:status_changed", { estimateId: "est-1", estimateNumber: "EST-1", status: "invoiced", invoiceId: "inv-9", orgId: "org-1" }],
    ]);

    emitHookMock.mockReset();
    createInvoiceMock.mockResolvedValue({ error: "No AR account", status: 400 });
    expect(await convertEstimateToInvoice({ error: null }, form({ id: "est-1", invoiceNumber: "INV-9", invoiceDate: "2026-10-26" }))).toEqual({
      error: "No AR account",
    });
    expect(emitted()).toEqual([]);
  });
});

describe("credit memos", () => {
  const input = {
    customerId: "c1",
    memoNumber: " CM-1 ",
    memoDate: "2026-10-26",
    reason: "",
    invoiceId: "inv-2",
    lines: [
      { accountId: "sales", description: "", amount: 3.1 },
      { accountId: "sales", description: "", amount: 1.9 },
    ],
  };
  const payment = ok({ id: "pay-1", invoice_id: "inv-2", invoices: { status: "partial" } });

  it("fires invoice_payment:recorded and credit_memo:created when it's applied as it's made", async () => {
    useClient({ tables: { invoice_payments: { select: payment } }, rpcs: { create_credit_memo: ok("cm-1") } });
    expect(await createCreditMemo(input)).toEqual({ error: null });
    expect(emitted()).toEqual([
      ["invoice_payment:recorded", { paymentId: "pay-1", invoiceId: "inv-2", invoiceStatus: "partial", orgId: "org-1" }],
      ["credit_memo:created", { creditMemoId: "cm-1", memoNumber: "CM-1", customerId: "c1", total: 5, appliedToInvoiceId: "inv-2", orgId: "org-1" }],
    ]);
  });

  it("fires only credit_memo:created when it's held as credit", async () => {
    useClient({ tables: {}, rpcs: { create_credit_memo: ok("cm-1") } });
    await createCreditMemo({ ...input, invoiceId: null });
    expect(emitted()).toEqual([
      ["credit_memo:created", { creditMemoId: "cm-1", memoNumber: "CM-1", customerId: "c1", total: 5, appliedToInvoiceId: null, orgId: "org-1" }],
    ]);
  });

  it("fires invoice_payment:recorded when held credit is applied later, and nothing when that's refused", async () => {
    useClient({ tables: { invoice_payments: { select: payment } }, rpc: ok({ status: "partial" }) });
    await applyCreditMemo(form({ memoId: "cm-1", invoiceId: "inv-2" }));
    expect(emitted()).toEqual([
      ["invoice_payment:recorded", { paymentId: "pay-1", invoiceId: "inv-2", invoiceStatus: "partial", orgId: "org-1" }],
    ]);

    emitHookMock.mockReset();
    useClient({ tables: {}, rpc: fail("Already applied") });
    await expect(applyCreditMemo(form({ memoId: "cm-1", invoiceId: "inv-2" }))).rejects.toThrow("Already applied");
    expect(emitted()).toEqual([]);
  });
});
