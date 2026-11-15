import { describe, it, expect, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase/middleware", () => ({
  updateSession: vi.fn(async () => new Response("session-ok", { status: 200 })),
}));

import { proxy } from "@/proxy";

describe("proxy middleware allow-list", () => {
  const originalEnv = process.env.ALLOWED_PROXY_IP;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.ALLOWED_PROXY_IP = originalEnv;
    } else {
      delete process.env.ALLOWED_PROXY_IP;
    }
  });

  it("passes through when ALLOWED_PROXY_IP is unset", async () => {
    delete process.env.ALLOWED_PROXY_IP;
    const req = new NextRequest("https://foqb.example.com/welcome", {
      headers: { "x-forwarded-for": "198.51.100.1" },
    });
    const res = await proxy(req);
    expect(res.status).toBe(200);
  });

  it("blocks a request with no x-forwarded-for header at all", async () => {
    process.env.ALLOWED_PROXY_IP = "10.0.0.5";
    const req = new NextRequest("https://foqb.example.com/dashboard");
    const res = await proxy(req);
    expect(res.status).toBe(403);
  });

  it("allows when single x-forwarded-for matches ALLOWED_PROXY_IP", async () => {
    process.env.ALLOWED_PROXY_IP = "10.0.0.5";
    const req = new NextRequest("https://foqb.example.com/dashboard", {
      headers: { "x-forwarded-for": "10.0.0.5" },
    });
    const res = await proxy(req);
    expect(res.status).toBe(200);
  });

  it("rejects when rightmost hop does not match ALLOWED_PROXY_IP", async () => {
    process.env.ALLOWED_PROXY_IP = "10.0.0.5";
    // Client attempts to spoof by putting ALLOWED_PROXY_IP leftmost, but connecting peer is 198.51.100.2
    const req = new NextRequest("https://foqb.example.com/dashboard", {
      headers: { "x-forwarded-for": "10.0.0.5, 198.51.100.2" },
    });
    const res = await proxy(req);
    expect(res.status).toBe(403);
  });

  it("allows when rightmost hop matches ALLOWED_PROXY_IP", async () => {
    process.env.ALLOWED_PROXY_IP = "10.0.0.5";
    const req = new NextRequest("https://foqb.example.com/dashboard", {
      headers: { "x-forwarded-for": "198.51.100.2, 10.0.0.5" },
    });
    const res = await proxy(req);
    expect(res.status).toBe(200);
  });
});
