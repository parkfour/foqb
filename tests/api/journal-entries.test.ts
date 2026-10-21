import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createSupabaseMock, fail, ok } from "./supabase-mock";

const { serverClientMock } = vi.hoisted(() => ({ serverClientMock: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({ createClient: serverClientMock }));

import { POST } from "@/app/api/journal-entries/route";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/journal-entries", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const validBody = {
  organization_id: "org-1",
  entry_date: "2026-02-01",
  memo: "Test entry",
  lines: [
    { account_id: "cash", debit: 100, credit: 0 },
    { account_id: "revenue", debit: 0, credit: 100 },
  ],
};

describe("POST /api/journal-entries", () => {
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

  it("returns 400 when debits and credits don't balance", async () => {
    const { client } = createSupabaseMock({
      user: { id: "user-1" },
      tables: { organization_members: { select: ok({ id: "m-1" }) } },
    });
    serverClientMock.mockResolvedValue(client);

    const response = await POST(
      makeRequest({
        ...validBody,
        lines: [
          { account_id: "cash", debit: 100, credit: 0 },
          { account_id: "revenue", debit: 0, credit: 90 },
        ],
      }),
    );
    expect(response.status).toBe(400);
    const json = (await response.json()) as { error: string };
    expect(json.error).toMatch(/equal total credits/i);
  });

  it("accepts an entry that balances to the cent despite float rounding (0.1 + 0.2 vs 0.3)", async () => {
    const { client } = createSupabaseMock({
      user: { id: "user-1" },
      tables: {
        organization_members: { select: ok({ id: "m-1" }) },
        organizations: { select: ok(null) },
      },
      rpcs: { post_journal_entry: ok("entry-f") },
    });
    serverClientMock.mockResolvedValue(client);

    const response = await POST(
      makeRequest({
        ...validBody,
        lines: [
          { account_id: "cash", debit: 0.1, credit: 0 },
          { account_id: "cash", debit: 0.2, credit: 0 },
          { account_id: "revenue", debit: 0, credit: 0.3 },
        ],
      }),
    );
    expect(response.status).toBe(200);
  });

  it("returns 400 when total debits are zero", async () => {
    const { client } = createSupabaseMock({
      user: { id: "user-1" },
      tables: { organization_members: { select: ok({ id: "m-1" }) } },
    });
    serverClientMock.mockResolvedValue(client);

    const response = await POST(
      makeRequest({
        ...validBody,
        lines: [
          { account_id: "cash", debit: 0, credit: 0 },
          { account_id: "revenue", debit: 0, credit: 0 },
        ],
      }),
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 when entry_date falls within the locked period", async () => {
    const { client } = createSupabaseMock({
      user: { id: "user-1" },
      tables: {
        organization_members: { select: ok({ id: "m-1" }) },
        organizations: { select: ok({ period_lock_date: "2026-02-01" }) },
      },
    });
    serverClientMock.mockResolvedValue(client);

    const response = await POST(makeRequest({ ...validBody, entry_date: "2026-02-01" }));
    expect(response.status).toBe(400);
    const json = (await response.json()) as { error: string };
    expect(json.error).toMatch(/locked period/i);
  });

  it("allows an entry dated strictly after the locked period", async () => {
    const { client } = createSupabaseMock({
      user: { id: "user-1" },
      tables: {
        organization_members: { select: ok({ id: "m-1" }) },
        organizations: { select: ok({ period_lock_date: "2026-02-01" }) },
      },
      rpcs: { post_journal_entry: ok("entry-1") },
    });
    serverClientMock.mockResolvedValue(client);

    const response = await POST(makeRequest({ ...validBody, entry_date: "2026-02-02" }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, id: "entry-1" });
  });

  it("posts the entry and its lines in one post_journal_entry call", async () => {
    const { client } = createSupabaseMock({
      user: { id: "user-1" },
      tables: {
        organization_members: { select: ok({ id: "m-1" }) },
        organizations: { select: ok(null) },
      },
      rpcs: { post_journal_entry: ok("entry-2") },
    });
    serverClientMock.mockResolvedValue(client);

    await POST(makeRequest(validBody));

    expect(client.rpc).toHaveBeenCalledWith("post_journal_entry", {
      p_org_id: "org-1",
      p_entry_date: "2026-02-01",
      p_memo: "Test entry",
      p_lines: [
        { account_id: "cash", debit: 100, credit: 0 },
        { account_id: "revenue", debit: 0, credit: 100 },
      ],
    });
  });

  it("returns 500 with the database's reason when posting fails", async () => {
    const { client } = createSupabaseMock({
      user: { id: "user-1" },
      tables: {
        organization_members: { select: ok({ id: "m-1" }) },
        organizations: { select: ok(null) },
      },
      rpcs: { post_journal_entry: fail("connection lost") },
    });
    serverClientMock.mockResolvedValue(client);

    const response = await POST(makeRequest(validBody));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "connection lost" });
  });

  it("returns 400 when the database refuses the entry itself", async () => {
    const { client } = createSupabaseMock({
      user: { id: "user-1" },
      tables: {
        organization_members: { select: ok({ id: "m-1" }) },
        organizations: { select: ok(null) },
      },
      rpcs: { post_journal_entry: fail("trigger blocked", "P0001") },
    });
    serverClientMock.mockResolvedValue(client);

    const response = await POST(makeRequest(validBody));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "trigger blocked" });
  });
});
