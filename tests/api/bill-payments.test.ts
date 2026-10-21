import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createSupabaseMock, fail, ok } from "./supabase-mock";

const { serverClientMock } = vi.hoisted(() => ({ serverClientMock: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({ createClient: serverClientMock }));

import { POST } from "@/app/api/bill-payments/route";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/bill-payments", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const record = { id: "bill-1", organization_id: "org-1", bill_number: "NUM-1", status: "open" };

// Balance/bank-transaction rules and posting live in record_bill_payment
// (tests/db/record-payments.test.ts); this covers the route's own wiring.
function mockClient(rpcResult: ReturnType<typeof ok> | ReturnType<typeof fail>, member = true) {
  const { client } = createSupabaseMock({
    user: { id: "user-1" },
    tables: {
      bills: { select: ok(record) },
      organization_members: { select: ok(member ? { id: "m-1" } : null) },
      organizations: { select: ok({ ap_account_id: "ap-account" }) },
    },
    rpcs: { record_bill_payment: rpcResult },
  });
  serverClientMock.mockResolvedValue(client);
  return client;
}

describe("POST /api/bill-payments", () => {
  beforeEach(() => {
    serverClientMock.mockReset();
  });

  it("returns 400 when bill or payment date is missing", async () => {
    const { client } = createSupabaseMock({ tables: {} });
    serverClientMock.mockResolvedValue(client);

    const response = await POST(makeRequest({ bill_id: "bill-1" }));
    expect(response.status).toBe(400);
  });

  it("returns 403 for a non-member", async () => {
    const client = mockClient(ok({ id: "p-1", status: "paid" }), false);

    const response = await POST(makeRequest({ bill_id: "bill-1", payment_date: "2026-02-01", amount: 10 }));
    expect(response.status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("records the payment through record_bill_payment with the org's control account", async () => {
    const client = mockClient(ok({ id: "p-1", status: "partial" }));

    const response = await POST(
      makeRequest({
        bill_id: "bill-1",
        payment_date: "2026-02-01",
        amount: 60,
        payment_account_id: "cash-account",
        bank_transaction_id: "tx-1",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, id: "p-1", status: "partial" });
    expect(client.rpc).toHaveBeenCalledWith("record_bill_payment", {
      p_bill_id: "bill-1",
      p_payment_date: "2026-02-01",
      p_amount: 60,
      p_payment_account_id: "cash-account",
      p_ap_account_id: "ap-account",
      p_bank_transaction_id: "tx-1",
    });
  });

  it("returns the database's rejection as a 400", async () => {
    mockClient(fail("Amount exceeds the remaining balance of 120.00"));

    const response = await POST(
      makeRequest({ bill_id: "bill-1", payment_date: "2026-02-01", amount: 121, payment_account_id: "cash-account" }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Amount exceeds the remaining balance of 120.00" });
  });
});
