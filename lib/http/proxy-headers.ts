// Used to build absolute redirect URLs from the request's own origin.
export function resolveOrigin(request: Request): string {
  return new URL(request.url).origin;
}

// Vercel overwrites x-forwarded-for with the actual connecting peer's IP on
// every plan below Enterprise (see proxy.ts), so this can't be spoofed on a
// direct connection. Takes a Headers object (from next/headers()) since
// Server Actions don't receive a Request/NextRequest directly.
//
// Behind ALLOWED_PROXY_IP, though, the connecting peer is always the proxy,
// so every visitor would share one rate-limit bucket. The proxy then passes
// the real client IP in X-Client-IP (which it must *set*, overwriting any
// client-supplied value); that header is only trusted when the proxy gate
// is on, since proxy.ts has already rejected anything not from the proxy.
export function getClientIp(headersList: Headers): string {
  if (process.env.ALLOWED_PROXY_IP) {
    const proxiedIp = headersList.get("x-client-ip")?.trim();
    if (proxiedIp) return proxiedIp;
  }
  return headersList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

// A post-sign-in destination taken from the URL (?next=...). Only paths on
// this site: one leading "/" and nothing that would make the browser read
// it as another host ("//evil.com", "/\evil.com", or "@evil.com" appended
// to the origin). Anything else lands on "/".
export function safeNextPath(next: string | null): string {
  if (!next || !/^\/(?![/\\])/.test(next) || /[\u0000-\u001f\u007f]/.test(next)) return "/";
  return next;
}
