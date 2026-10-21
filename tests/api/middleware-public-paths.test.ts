import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getUserMock, getAalMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  getAalMock: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: {
      getUser: getUserMock,
      mfa: { getAuthenticatorAssuranceLevel: getAalMock },
    },
  })),
}));

// after() throws outside a real Next.js request scope, which calling
// updateSession() directly (as every test here does) isn't — the piggyback
// trigger it wraps has its own dedicated tests, so a no-op is fine here.
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: vi.fn() };
});

function makeRequest(pathname: string): NextRequest {
  return new NextRequest(`https://foqb.vercel.app${pathname}`);
}

describe("updateSession public-path gating", () => {
  afterEach(() => {
    vi.resetModules();
    getUserMock.mockReset();
    getAalMock.mockReset();
  });

  it("sends an unauthenticated visitor from the bare root to /welcome, not /login", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const { updateSession } = await import("@/lib/supabase/middleware");

    const response = await updateSession(makeRequest("/"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://foqb.vercel.app/welcome");
  });

  it.each(["/welcome", "/privacy", "/terms", "/security"])(
    "leaves an unauthenticated visitor to %s alone",
    async (path) => {
      getUserMock.mockResolvedValue({ data: { user: null } });
      const { updateSession } = await import("@/lib/supabase/middleware");

      const response = await updateSession(makeRequest(path));
      expect(response.headers.get("location")).toBeNull();
    },
  );

  it("still sends an unauthenticated visitor to a protected page to /login", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const { updateSession } = await import("@/lib/supabase/middleware");

    const response = await updateSession(makeRequest("/settings"));
    expect(response.headers.get("location")).toBe("https://foqb.vercel.app/login");
  });
});
