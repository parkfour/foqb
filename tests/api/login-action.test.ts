import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock } from "./supabase-mock";

const { serverClientMock, redirectMock, checkRateLimitMock, clearRateLimitMock } = vi.hoisted(() => ({
  serverClientMock: vi.fn(),
  redirectMock: vi.fn(),
  checkRateLimitMock: vi.fn(),
  clearRateLimitMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: serverClientMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "1.2.3.4" }) }));
vi.mock("@/lib/auth/rate-limit", () => ({ checkRateLimit: checkRateLimitMock, clearRateLimit: clearRateLimitMock }));

import { login } from "@/app/login/actions";

function form(email: string, password: string) {
  const fd = new FormData();
  fd.set("email", email);
  fd.set("password", password);
  return fd;
}

function mockSignIn(error: { message: string } | null) {
  const { client } = createSupabaseMock({ tables: {}, aal: "aal1" });
  Object.assign(client.auth, { signInWithPassword: vi.fn(async () => ({ data: {}, error })) });
  serverClientMock.mockResolvedValue(client);
}

beforeEach(() => {
  serverClientMock.mockReset();
  clearRateLimitMock.mockReset().mockResolvedValue(undefined);
  checkRateLimitMock.mockReset().mockResolvedValue(true);
  redirectMock.mockReset().mockImplementation((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  });
});

describe("login", () => {
  it("clears the per-email attempt counter after a successful sign-in", async () => {
    mockSignIn(null);
    await expect(login(form("Owner@Example.com", "right"))).rejects.toThrow("REDIRECT:/");
    expect(clearRateLimitMock).toHaveBeenCalledWith("login:email", "owner@example.com");
  });

  it("keeps counting failed sign-ins", async () => {
    mockSignIn({ message: "Invalid login credentials" });
    await expect(login(form("owner@example.com", "wrong"))).rejects.toThrow(/REDIRECT:\/login\?error=/);
    expect(clearRateLimitMock).not.toHaveBeenCalled();
  });
});
