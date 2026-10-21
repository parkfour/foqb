import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createSupabaseMock, fail, ok } from "./supabase-mock";

const { serverClientMock } = vi.hoisted(() => ({ serverClientMock: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({ createClient: serverClientMock }));

import { POST } from "@/app/api/invoice-payments/route";
import { on, resetRegistry } from "@/lib/plugins/hooks";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/invoice-payments", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const record = { id: "invoice-1", organization_id: "org-1", invoice_number: "NUM-1", status: "open" };

// Balance/bank-transaction rules and posting live in record_invoice_payment
// (tests/db/record-payments.test.ts); this covers the route's own wiring.
function mockClient(rpcResult: ReturnType<typeof ok> | ReturnType<typeof fail>, member = true) {
  const { client } = createSupabaseMock({
    user: { id: "user-1" },
    tables: {
      invoices: { select: ok(record) },
      organization_members: { select: ok(member ? { id: "m-1" } : null) },
      organizations: { select: ok({ ar_account_id: "ar-account" }) },
    },
    rpcs: { record_invoice_payment: rpcResult },
  });
  serverClientMock.mockResolvedValue(client);
  return client;
}

describe("POST /api/invoice-payments", () => {
  beforeEach(() => {
    serverClientMock.mockReset();
  });

  it("returns 400 when invoice or payment date is missing", async () => {
    const { client } = createSupabaseMock({ tables: {} });
    serverClientMock.mockResolvedValue(client);

    const response = await POST(makeRequest({ invoice_id: "invoice-1" }));
    expect(response.status).toBe(400);
  });

  it("returns 403 for a non-member", async () => {
    const client = mockClient(ok({ id: "p-1", status: "paid" }), false);

    const response = await POST(makeRequest({ invoice_id: "invoice-1", payment_date: "2026-02-01", amount: 10 }));
    expect(response.status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("records the payment through record_invoice_payment with the org's control account", async () => {
    const client = mockClient(ok({ id: "p-1", status: "partial" }));

    const response = await POST(
      makeRequest({
        invoice_id: "invoice-1",
        payment_date: "2026-02-01",
        amount: 60,
        deposit_account_id: "cash-account",
        bank_transaction_id: "tx-1",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, id: "p-1", status: "partial" });
    expect(client.rpc).toHaveBeenCalledWith("record_invoice_payment", {
      p_invoice_id: "invoice-1",
      p_payment_date: "2026-02-01",
      p_amount: 60,
      p_deposit_account_id: "cash-account",
      p_ar_account_id: "ar-account",
      p_bank_transaction_id: "tx-1",
    });
  });

  it("returns the database's rejection as a 400", async () => {
    mockClient(fail("Amount exceeds the remaining balance of 120.00"));

    const response = await POST(
      makeRequest({ invoice_id: "invoice-1", payment_date: "2026-02-01", amount: 121, deposit_account_id: "cash-account" }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Amount exceeds the remaining balance of 120.00" });
  });

  it("tells plugins about a recorded payment, and only once it's saved", async () => {
    resetRegistry();
    const handler = vi.fn();
    on("invoice_payment:recorded", handler);

    mockClient(fail("Amount exceeds the remaining balance of 120.00"));
    await POST(makeRequest({ invoice_id: "invoice-1", payment_date: "2026-02-01", amount: 121, deposit_account_id: "cash-account" }));
    expect(handler).not.toHaveBeenCalled();

    mockClient(ok({ id: "p-1", status: "paid" }));
    await POST(makeRequest({ invoice_id: "invoice-1", payment_date: "2026-02-01", amount: 120, deposit_account_id: "cash-account" }));
    expect(handler).toHaveBeenCalledWith({ paymentId: "p-1", invoiceId: "invoice-1", invoiceStatus: "paid", orgId: "org-1" });
    resetRegistry();
  });
});
