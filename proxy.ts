import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Restricts the deployment to a single trusted reverse proxy (e.g. an Apache
// front door doing client-certificate auth) when ALLOWED_PROXY_IP is set.
// On Vercel, x-forwarded-for is set to the connecting peer's IP. In self-hosted
// setups where an upstream proxy appends to x-forwarded-for, the rightmost hop
// represents the address added by the connecting proxy. Self-hosted front
// proxies must also be configured to overwrite or sanitize incoming
// X-Forwarded-For headers from clients.
// Unset (e.g. local dev) skips the check entirely.
export async function proxy(request: NextRequest) {
  const allowedProxyIp = process.env.ALLOWED_PROXY_IP;
  if (allowedProxyIp) {
    const hops = request.headers.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
    const clientIp = hops.at(-1);
    if (clientIp !== allowedProxyIp) {
      return new NextResponse("Forbidden", { status: 403 });
    }
  }

  return updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|sw.js|manifest.json|icons/|ocr/).*)"],
};
