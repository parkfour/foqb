import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createSupabaseMock, ok } from "./supabase-mock";

const { serverClientMock } = vi.hoisted(() => ({ serverClientMock: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({ createClient: serverClientMock }));

import { POST } from "@/app/api/invoices/route";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/invoices", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const validBody = {
  organization_id: "org-1",
  customer_id: "cust-1",
  invoice_number: "INV-1",
  invoice_date: "2026-02-01",
  due_date: null,
  lines: [{ account_id: "revenue-1", description: "Consulting", quantity: 2, unit_price: 50 }],
};

describe("POST /api/invoices", () => {
  beforeEach(() => {
    serverClientMock.mockReset();
  });

  it("returns 400 when required fields are missing", async () => {
    const { client } = createSupabaseMock({ tables: {} });
    serverClientMock.mockResolvedValue(client);

    const response = await POST(makeRequest({ organization_id: "org-1" }));
    expect(response.status).toBe(400);
  });

  it("returns 401 when unauthenticated", async () => {
    const { client } = createSupabaseMock({ user: null, tables: {} });
    serverClientMock.mockResolvedValue(client);

    const response = await POST(makeRequest(validBody));
    expect(response.status).toBe(401);
  });

  it("returns 403 when the user is not a member of the organization", async () => {
    const { client } = createSupabaseMock({
      user: { id: "user-1" },
      tables: { organization_members: { select: ok(null) } },
    });
    serverClientMock.mockResolvedValue(client);

    const response = await POST(makeRequest(validBody));
    expect(response.status).toBe(403);
  });

  it("returns 400 when a line has no account or a non-positive amount", async () => {
    const { client } = createSupabaseMock({
      user: { id: "user-1" },
      tables: { organization_members: { select: ok({ id: "m-1" }) } },
    });
    serverClientMock.mockResolvedValue(client);

    const response = await POST(
      makeRequest({ ...validBody, lines: [{ account_id: "", description: "x", quantity: 1, unit_price: 10 }] }),
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 when no Accounts Receivable control account can be found", async () => {
    const { client } = createSupabaseMock({
      user: { id: "user-1" },
      tables: {
        organization_members: { select: ok({ id: "m-1" }) },
        organizations: { select: ok(null) },
        accounts: { select: ok(null) },
      },
    });
    serverClientMock.mockResolvedValue(client);

    const response = await POST(makeRequest(validBody));
    expect(response.status).toBe(400);
    const json = (await response.json()) as { error: string };
    expect(json.error).toMatch(/accounts receivable/i);
  });

  it("posts a balanced entry (Dr AR = Cr revenue lines) and creates the invoice", async () => {
    const { client, tables } = createSupabaseMock({
      user: { id: "user-1" },
      tables: {
        organization_members: { select: ok({ id: "m-1" }) },
        organizations: { select: ok(null) },
        accounts: { select: ok({ id: "ar-account" }) },
        journal_entries: { insert: ok(null), update: ok(null) },
        journal_lines: { insert: ok(null) },
        invoices: { insert: ok(null) },
        invoice_lines: { insert: ok(null) },
      },
    });
    serverClientMock.mockResolvedValue(client);

    const response = await POST(makeRequest(validBody));
    expect(response.status).toBe(200);
    const json = (await response.json()) as { success: boolean; id: string };
    expect(json.success).toBe(true);

    const linesInsertCall = tables.journal_lines.insert.mock.calls[0][0] as {
      account_id: string;
      debit: number;
      credit: number;
    }[];
    const totalDebit = linesInsertCall.reduce((sum, l) => sum + l.debit, 0);
    const totalCredit = linesInsertCall.reduce((sum, l) => sum + l.credit, 0);
    expect(totalDebit).toBe(totalCredit);
    expect(totalDebit).toBe(100);
    expect(linesInsertCall.find((l) => l.account_id === "ar-account")?.debit).toBe(100);
  });

  it("uses the org's explicit ar_account_id setting when set, without a name-based lookup", async () => {
    const { client, tables } = createSupabaseMock({
      user: { id: "user-1" },
      tables: {
        organization_members: { select: ok({ id: "m-1" }) },
        organizations: { select: ok({ ar_account_id: "explicit-ar-account" }) },
        journal_entries: { insert: ok(null), update: ok(null) },
        journal_lines: { insert: ok(null) },
        invoices: { insert: ok(null) },
        invoice_lines: { insert: ok(null) },
      },
    });
    serverClientMock.mockResolvedValue(client);

    const response = await POST(makeRequest(validBody));
    expect(response.status).toBe(200);

    const linesInsertCall = tables.journal_lines.insert.mock.calls[0][0] as {
      account_id: string;
      debit: number;
    }[];
    expect(linesInsertCall.find((l) => l.account_id === "explicit-ar-account")?.debit).toBe(100);
  });

  it("adds a tax payable credit line and debits AR for subtotal + tax", async () => {
    const { client, tables } = createSupabaseMock({
      user: { id: "user-1" },
      tables: {
        organization_members: { select: ok({ id: "m-1" }) },
        organizations: {
          select: ok({ ar_account_id: "ar-account", tax_payable_account_id: "tax-account" }),
        },
        journal_entries: { insert: ok(null), update: ok(null) },
        journal_lines: { insert: ok(null) },
        invoices: { insert: ok(null) },
        invoice_lines: { insert: ok(null) },
      },
    });
    serverClientMock.mockResolvedValue(client);

    const response = await POST(makeRequest({ ...validBody, tax_rate: 10 }));
    expect(response.status).toBe(200);

    const linesInsertCall = tables.journal_lines.insert.mock.calls[0][0] as {
      account_id: string;
      debit: number;
      credit: number;
    }[];
    const totalDebit = linesInsertCall.reduce((sum, l) => sum + l.debit, 0);
    const totalCredit = linesInsertCall.reduce((sum, l) => sum + l.credit, 0);
    expect(totalDebit).toBe(totalCredit);
    expect(totalDebit).toBe(110);
    expect(linesInsertCall.find((l) => l.account_id === "ar-account")?.debit).toBe(110);
    expect(linesInsertCall.find((l) => l.account_id === "tax-account")?.credit).toBe(10);

    const invoiceInsertCall = tables.invoices.insert.mock.calls[0][0] as {
      tax_rate: number;
      tax_amount: number;
    };
    expect(invoiceInsertCall.tax_rate).toBe(10);
    expect(invoiceInsertCall.tax_amount).toBe(10);
  });

  it("returns 400 when tax is owed but no Sales Tax Payable control account can be found", async () => {
    const { client } = createSupabaseMock({
      user: { id: "user-1" },
      tables: {
        organization_members: { select: ok({ id: "m-1" }) },
        organizations: { select: ok({ ar_account_id: "ar-account" }) },
        accounts: { select: ok(null) },
      },
    });
    serverClientMock.mockResolvedValue(client);

    const response = await POST(makeRequest({ ...validBody, tax_rate: 10 }));
    expect(response.status).toBe(400);
    const json = (await response.json()) as { error: string };
    expect(json.error).toMatch(/sales tax payable/i);
  });
});
