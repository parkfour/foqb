import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { updateSessionMock } = vi.hoisted(() => ({ updateSessionMock: vi.fn() }));

vi.mock("@/lib/supabase/middleware", () => ({ updateSession: updateSessionMock }));

function makeRequest(xForwardedFor?: string): NextRequest {
  return new NextRequest("https://foqb.vercel.app/", {
    headers: xForwardedFor ? { "x-forwarded-for": xForwardedFor } : {},
  });
}

describe("proxy", () => {
  const originalEnv = process.env.ALLOWED_PROXY_IP;

  beforeEach(() => {
    updateSessionMock.mockReset();
    updateSessionMock.mockResolvedValue(new Response("ok"));
  });

  afterEach(() => {
    process.env.ALLOWED_PROXY_IP = originalEnv;
    vi.resetModules();
  });

  it("skips the IP check entirely when ALLOWED_PROXY_IP is unset", async () => {
    delete process.env.ALLOWED_PROXY_IP;
    const { proxy } = await import("@/proxy");

    await proxy(makeRequest("1.2.3.4"));
    expect(updateSessionMock).toHaveBeenCalledTimes(1);
  });

  it("blocks a request whose x-forwarded-for doesn't match the allowed IP", async () => {
    process.env.ALLOWED_PROXY_IP = "216.144.227.186";
    const { proxy } = await import("@/proxy");

    const response = await proxy(makeRequest("1.2.3.4"));
    expect(response.status).toBe(403);
    expect(updateSessionMock).not.toHaveBeenCalled();
  });

  it("blocks a request with no x-forwarded-for header at all", async () => {
    process.env.ALLOWED_PROXY_IP = "216.144.227.186";
    const { proxy } = await import("@/proxy");

    const response = await proxy(makeRequest());
    expect(response.status).toBe(403);
  });

  it("allows a request whose x-forwarded-for matches the allowed IP", async () => {
    process.env.ALLOWED_PROXY_IP = "216.144.227.186";
    const { proxy } = await import("@/proxy");

    await proxy(makeRequest("216.144.227.186"));
    expect(updateSessionMock).toHaveBeenCalledTimes(1);
  });

  it("takes the first hop when x-forwarded-for has multiple comma-separated IPs", async () => {
    process.env.ALLOWED_PROXY_IP = "216.144.227.186";
    const { proxy } = await import("@/proxy");

    await proxy(makeRequest("216.144.227.186, 10.0.0.1"));
    expect(updateSessionMock).toHaveBeenCalledTimes(1);
  });
});
