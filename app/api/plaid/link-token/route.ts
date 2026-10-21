import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hasPassedMfa, MFA_REQUIRED_FOR_BANKS } from "@/lib/auth/mfa";
import { createAdminClient } from "@/lib/supabase/admin";
import { createLinkToken, describePlaidError } from "@/lib/plaid/client";
import { findWritableEnrollment } from "@/lib/plaid/writable-enrollment";
import { decryptToken } from "@/lib/crypto/token-encryption";
import { bankLinkingBlockedReason } from "@/lib/plaid/bank-linking";

// { organizationId }: a Link token for connecting a new bank to that org.
// { enrollmentId }: an update-mode token to reconnect that existing one.
export async function POST(req: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await hasPassedMfa(supabase))) {
    return NextResponse.json({ error: MFA_REQUIRED_FOR_BANKS }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    enrollmentId?: string;
    organizationId?: string;
    addAccounts?: boolean;
  };

  const enrollment = body.enrollmentId
    ? await findWritableEnrollment(supabase, user.id, body.enrollmentId)
    : null;
  if (body.enrollmentId && !enrollment) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const organizationId = enrollment?.organization_id ?? body.organizationId;
  if (!organizationId) {
    return NextResponse.json({ error: "organizationId is required" }, { status: 400 });
  }

  const blocked = await bankLinkingBlockedReason(supabase, organizationId);
  if (blocked) {
    return NextResponse.json({ error: blocked }, { status: 403 });
  }

  let accessToken: string | undefined;
  if (enrollment) {
    // Not readable with the user's own client (see
    // 20260101000037_hide_enrollment_access_token.sql).
    const { data: secret } = await createAdminClient()
      .from("enrollments")
      .select("access_token")
      .eq("id", enrollment.id)
      .maybeSingle();
    if (!secret) {
      return NextResponse.json({ error: "Bank connection not found" }, { status: 404 });
    }
    accessToken = decryptToken(secret.access_token as string);
  }

  try {
    const linkToken = await createLinkToken(user.id, accessToken, body.addAccounts === true);
    return NextResponse.json({ linkToken });
  } catch (error) {
    // Plaid's message names the dashboard setting that's missing (no secrets in it).
    const detail = describePlaidError(error);
    console.error(`Failed to create Plaid link token: ${detail}`);
    return NextResponse.json({ error: `Couldn't start the bank connection. ${detail}` }, { status: 500 });
  }
}
