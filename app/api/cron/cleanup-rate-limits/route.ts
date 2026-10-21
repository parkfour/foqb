import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron/authorize";
import { cleanupRateLimits } from "@/lib/cron/cleanup-rate-limits";

// No longer scheduled by Vercel Cron (see lib/cron/piggyback.ts) — this
// route stays as a manual/on-demand trigger, still gated on CRON_SECRET.
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await cleanupRateLimits();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
