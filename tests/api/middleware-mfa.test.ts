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

describe("updateSession MFA gating", () => {
  afterEach(() => {
    vi.resetModules();
    getUserMock.mockReset();
    getAalMock.mockReset();
  });

  it("redirects to the MFA challenge when a session hasn't reached the required level", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "u1" } } });
    getAalMock.mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal2" } });
    const { updateSession } = await import("@/lib/supabase/middleware");

    const response = await updateSession(makeRequest("/"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://foqb.vercel.app/login/mfa");
  });

  it("allows the request through once the required level is reached", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "u1" } } });
    getAalMock.mockResolvedValue({ data: { currentLevel: "aal2", nextLevel: "aal2" } });
    const { updateSession } = await import("@/lib/supabase/middleware");

    const response = await updateSession(makeRequest("/"));
    expect(response.headers.get("location")).toBeNull();
  });

  it("redirects away from the challenge page once no longer needed", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "u1" } } });
    getAalMock.mockResolvedValue({ data: { currentLevel: "aal2", nextLevel: "aal2" } });
    const { updateSession } = await import("@/lib/supabase/middleware");

    const response = await updateSession(makeRequest("/login/mfa"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://foqb.vercel.app/");
  });

  it("returns 401 JSON for API routes until the required level is reached", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "u1" } } });
    getAalMock.mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal2" } });
    const { updateSession } = await import("@/lib/supabase/middleware");

    const response = await updateSession(makeRequest("/api/export/organization"));
    expect(response.status).toBe(401);
    expect(response.headers.get("location")).toBeNull();
    expect(await response.json()).toEqual({ error: "Multi-factor authentication required" });
  });

  it("lets API routes through once the required level is reached", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "u1" } } });
    getAalMock.mockResolvedValue({ data: { currentLevel: "aal2", nextLevel: "aal2" } });
    const { updateSession } = await import("@/lib/supabase/middleware");

    const response = await updateSession(makeRequest("/api/export/organization"));
    expect(response.status).toBe(200);
  });

  it("leaves a user with no verified factor alone (AAL unenforced)", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "u1" } } });
    getAalMock.mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal1" } });
    const { updateSession } = await import("@/lib/supabase/middleware");

    const response = await updateSession(makeRequest("/"));
    expect(response.headers.get("location")).toBeNull();
  });
});
