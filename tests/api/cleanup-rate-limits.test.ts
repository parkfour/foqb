import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createSupabaseMock, ok } from "./supabase-mock";

const { createAdminClientMock } = vi.hoisted(() => ({ createAdminClientMock: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));

import { GET } from "@/app/api/cron/cleanup-rate-limits/route";

const CRON_SECRET = "test-cron-secret";

function makeRequest(authorized = true): NextRequest {
  return new NextRequest("http://localhost/api/cron/cleanup-rate-limits", {
    headers: authorized ? { authorization: `Bearer ${CRON_SECRET}` } : {},
  });
}

describe("GET /api/cron/cleanup-rate-limits", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = CRON_SECRET;
    createAdminClientMock.mockReset();
  });

  it("rejects a request with no/wrong bearer token", async () => {
    const response = await GET(makeRequest(false));
    expect(response.status).toBe(401);
  });

  it("rejects the literal 'Bearer undefined' when CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET;
    const response = await GET(
      new NextRequest("http://localhost/api/cron/cleanup-rate-limits", {
        headers: { authorization: "Bearer undefined" },
      }),
    );
    expect(response.status).toBe(401);
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });

  it("reports how many stale windows were deleted", async () => {
    const { client, tables } = createSupabaseMock({
      tables: {
        rate_limit_hits: { select: ok([{ key: "login:ip:1.2.3.4" }, { key: "signup:ip:5.6.7.8" }]) },
      },
    });
    createAdminClientMock.mockReturnValue(client);

    const response = await GET(makeRequest());
    const body = (await response.json()) as { deleted: number };

    expect(response.status).toBe(200);
    expect(tables.rate_limit_hits.delete).toHaveBeenCalled();
    expect(body).toEqual({ deleted: 2 });
  });

  it("reports zero when nothing was stale", async () => {
    const { client } = createSupabaseMock({
      tables: { rate_limit_hits: { select: ok([]) } },
    });
    createAdminClientMock.mockReturnValue(client);

    const response = await GET(makeRequest());
    const body = (await response.json()) as { deleted: number };

    expect(body).toEqual({ deleted: 0 });
  });
});
