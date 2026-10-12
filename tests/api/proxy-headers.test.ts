import { afterEach, describe, expect, it } from "vitest";
import { getClientIp, resolveOrigin } from "@/lib/http/proxy-headers";

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("https://foqb.vercel.app/auth/callback?code=abc", { headers });
}

describe("resolveOrigin", () => {
  it("returns the request's own origin", () => {
    expect(resolveOrigin(makeRequest())).toBe("https://foqb.vercel.app");
  });
});

describe("getClientIp", () => {
  it("returns the first hop when x-forwarded-for has multiple comma-separated IPs", () => {
    const headers = new Headers({ "x-forwarded-for": "216.144.227.186, 10.0.0.1" });
    expect(getClientIp(headers)).toBe("216.144.227.186");
  });

  it("returns 'unknown' when x-forwarded-for is absent", () => {
    expect(getClientIp(new Headers())).toBe("unknown");
  });

  describe("behind ALLOWED_PROXY_IP", () => {
    afterEach(() => {
      delete process.env.ALLOWED_PROXY_IP;
    });

    it("uses the proxy-supplied X-Client-IP instead of the proxy's own address", () => {
      process.env.ALLOWED_PROXY_IP = "10.0.0.5";
      const headers = new Headers({ "x-forwarded-for": "10.0.0.5", "x-client-ip": "203.0.113.9" });
      expect(getClientIp(headers)).toBe("203.0.113.9");
    });

    it("falls back to x-forwarded-for when the proxy doesn't send X-Client-IP", () => {
      process.env.ALLOWED_PROXY_IP = "10.0.0.5";
      expect(getClientIp(new Headers({ "x-forwarded-for": "10.0.0.5" }))).toBe("10.0.0.5");
    });
  });

  it("ignores X-Client-IP when no proxy gate is configured (it'd be client-spoofable)", () => {
    const headers = new Headers({ "x-forwarded-for": "216.144.227.186", "x-client-ip": "1.1.1.1" });
    expect(getClientIp(headers)).toBe("216.144.227.186");
  });
});
