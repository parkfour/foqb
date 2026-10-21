import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createSupabaseMock, ok } from "./supabase-mock";

const { createAdminClientMock } = vi.hoisted(() => ({ createAdminClientMock: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));

import { GET } from "@/app/api/cron/cleanup-unclaimed-members/route";

const CRON_SECRET = "test-cron-secret";

function makeRequest(authorized = true): NextRequest {
  return new NextRequest("http://localhost/api/cron/cleanup-unclaimed-members", {
    headers: authorized ? { authorization: `Bearer ${CRON_SECRET}` } : {},
  });
}

describe("GET /api/cron/cleanup-unclaimed-members", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = CRON_SECRET;
    createAdminClientMock.mockReset();
  });

  it("rejects a request with no/wrong bearer token", async () => {
    const response = await GET(makeRequest(false));
    expect(response.status).toBe(401);
  });

  it("deletes an unclaimed account past the expiry window", async () => {
    const getUserById = vi.fn(async () => ({
      data: { user: { id: "user-1", last_sign_in_at: null } },
      error: null,
    }));
    const deleteUser = vi.fn(async () => ({ data: null, error: null }));

    const { client, tables } = createSupabaseMock({
      tables: {
        pending_member_accounts: {
          select: ok([{ id: "pending-1", user_id: "user-1", created_at: "2020-01-01T00:00:00Z" }]),
          delete: ok(null),
        },
      },
      authAdmin: { getUserById, deleteUser },
    });
    createAdminClientMock.mockReturnValue(client);

    const response = await GET(makeRequest());
    const body = (await response.json()) as { checked: number; deleted: number; claimed: number };

    expect(response.status).toBe(200);
    expect(deleteUser).toHaveBeenCalledWith("user-1");
    expect(tables.pending_member_accounts.delete).toHaveBeenCalled();
    expect(body).toEqual({ checked: 1, deleted: 1, claimed: 0 });
  });

  it("only removes the tracking row, not the account, for someone who already logged in", async () => {
    const getUserById = vi.fn(async () => ({
      data: { user: { id: "user-2", last_sign_in_at: "2026-01-01T00:00:00Z" } },
      error: null,
    }));
    const deleteUser = vi.fn(async () => ({ data: null, error: null }));

    const { client, tables } = createSupabaseMock({
      tables: {
        pending_member_accounts: {
          select: ok([{ id: "pending-2", user_id: "user-2", created_at: "2020-01-01T00:00:00Z" }]),
          delete: ok(null),
        },
      },
      authAdmin: { getUserById, deleteUser },
    });
    createAdminClientMock.mockReturnValue(client);

    const response = await GET(makeRequest());
    const body = (await response.json()) as { checked: number; deleted: number; claimed: number };

    expect(deleteUser).not.toHaveBeenCalled();
    expect(tables.pending_member_accounts.delete).toHaveBeenCalled();
    expect(body).toEqual({ checked: 1, deleted: 0, claimed: 1 });
  });

  it("does nothing when there are no expired pending accounts", async () => {
    const deleteUser = vi.fn();
    const { client } = createSupabaseMock({
      tables: { pending_member_accounts: { select: ok([]) } },
      authAdmin: { deleteUser },
    });
    createAdminClientMock.mockReturnValue(client);

    const response = await GET(makeRequest());
    const body = (await response.json()) as { checked: number; deleted: number; claimed: number };

    expect(deleteUser).not.toHaveBeenCalled();
    expect(body).toEqual({ checked: 0, deleted: 0, claimed: 0 });
  });
});
