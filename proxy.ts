import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Restricts the deployment to a single trusted reverse proxy (e.g. an Apache
// front door doing client-certificate auth) when ALLOWED_PROXY_IP is set.
// Vercel overwrites x-forwarded-for with the actual connecting peer's IP on
// every plan below Enterprise — https://vercel.com/docs/headers/request-headers
// — so this can't be bypassed by spoofing the header on a direct connection.
// Unset (e.g. local dev) skips the check entirely rather than failing closed.
const ALLOWED_PROXY_IP = process.env.ALLOWED_PROXY_IP;

export async function proxy(request: NextRequest) {
  if (ALLOWED_PROXY_IP) {
    const clientIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (clientIp !== ALLOWED_PROXY_IP) {
      return new NextResponse("Forbidden", { status: 403 });
    }
  }

  return updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|sw.js|manifest.json|icons/).*)"],
};
