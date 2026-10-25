import { createServerClient } from "@supabase/ssr";
import { NextResponse, after, type NextRequest } from "next/server";
import { resolveOrigin } from "@/lib/http/proxy-headers";
import { maybeRunDueCronJobs } from "@/lib/cron/piggyback";

const PUBLIC_PATHS = [
  "/login",
  "/signup",
  "/auth/callback",
  "/forgot-password",
  "/reset-password",
  "/welcome",
  "/privacy",
  "/changelog",
  "/terms",
  "/security",
];
const MFA_CHALLENGE_PATH = "/login/mfa";

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  // Piggybacks maintenance work (see lib/cron/piggyback.ts) on real
  // traffic instead of a scheduled job — after() defers this until the
  // response has already been sent, so it never adds latency here.
  after(() => void maybeRunDueCronJobs());

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isApiPath = pathname.startsWith("/api/");
  const isPublicPath = PUBLIC_PATHS.some((path) => pathname.startsWith(path));

  // API routes enforce their own auth (returning 401 JSON) — redirecting them
  // here would turn a fetch() call into a followed redirect to an HTML page.
  // The bare root gets a public landing page instead of an unlabeled login
  // wall — the first thing a cold visitor (e.g. sharing this link with a
  // bank-data provider's reviewer) sees shouldn't be a form with no context.
  if (!user && !isApiPath && !isPublicPath) {
    const destination = pathname === "/" ? "/welcome" : "/login";
    return NextResponse.redirect(new URL(destination, resolveOrigin(request)));
  }

  if (user && (pathname === "/login" || pathname === "/signup")) {
    return NextResponse.redirect(new URL("/", resolveOrigin(request)));
  }

  // A verified TOTP factor means the session must reach AAL2 before it's
  // trusted for anything beyond the challenge page itself — a signed-in
  // session cookie exists at AAL1 the moment the password check passes.
  // API routes get a 401 instead of a redirect (see isApiPath above); RLS
  // enforces the same rule for direct PostgREST access
  // (20260101000034_require_mfa_when_enrolled.sql).
  if (user) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    const needsMfaChallenge = aal != null && aal.currentLevel !== aal.nextLevel;

    if (needsMfaChallenge && isApiPath) {
      return NextResponse.json({ error: "Multi-factor authentication required" }, { status: 401 });
    }
    if (needsMfaChallenge && pathname !== MFA_CHALLENGE_PATH) {
      return NextResponse.redirect(new URL(MFA_CHALLENGE_PATH, resolveOrigin(request)));
    }
    if (!needsMfaChallenge && pathname === MFA_CHALLENGE_PATH) {
      return NextResponse.redirect(new URL("/", resolveOrigin(request)));
    }
  }

  return response;
}
