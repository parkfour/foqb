import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, fail, ok } from "./supabase-mock";

const { createAdminClientMock } = vi.hoisted(() => ({ createAdminClientMock: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));

import { checkRateLimit } from "@/lib/auth/rate-limit";

describe("checkRateLimit", () => {
  beforeEach(() => {
    createAdminClientMock.mockReset();
  });

  it("returns true when the RPC allows the request", async () => {
    const { client } = createSupabaseMock({ tables: {}, rpc: ok(true) });
    createAdminClientMock.mockReturnValue(client);

    expect(await checkRateLimit("login:ip", "1.2.3.4", 10, 900)).toBe(true);
    expect(client.rpc).toHaveBeenCalledWith("check_rate_limit", {
      p_key: "login:ip:1.2.3.4",
      p_limit: 10,
      p_window_seconds: 900,
    });
  });

  it("returns false when the RPC denies the request", async () => {
    const { client } = createSupabaseMock({ tables: {}, rpc: ok(false) });
    createAdminClientMock.mockReturnValue(client);

    expect(await checkRateLimit("login:ip", "1.2.3.4", 10, 900)).toBe(false);
  });

  it("fails open (allows the request) if the RPC errors", async () => {
    const { client } = createSupabaseMock({ tables: {}, rpc: fail("connection error") });
    createAdminClientMock.mockReturnValue(client);

    expect(await checkRateLimit("login:ip", "1.2.3.4", 10, 900)).toBe(true);
  });
});
