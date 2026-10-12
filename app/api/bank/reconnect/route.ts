import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hasPassedMfa, MFA_REQUIRED_FOR_BANKS } from "@/lib/auth/mfa";
import { findWritableEnrollment } from "@/lib/plaid/writable-enrollment";
import { syncItem } from "@/lib/plaid/sync";
import { bankLinkingBlockedReason } from "@/lib/plaid/bank-linking";

// Called after Plaid Link update mode succeeds: the Item's login works again
// (same Item, same ids — nothing to exchange), so mark it active and catch
// up on whatever couldn't sync while it was broken.
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

  const { enrollmentId } = (await req.json().catch(() => ({}))) as { enrollmentId?: string };
  if (!enrollmentId) {
    return NextResponse.json({ error: "enrollmentId is required" }, { status: 400 });
  }

  const enrollment = await findWritableEnrollment(supabase, user.id, enrollmentId);
  if (!enrollment) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const blocked = await bankLinkingBlockedReason(supabase, enrollment.organization_id);
  if (blocked) {
    return NextResponse.json({ error: blocked }, { status: 403 });
  }

  const { error } = await supabase
    .from("enrollments")
    .update({ status: "active", disconnect_reason: null })
    .eq("id", enrollment.id)
    .neq("status", "disconnected");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  try {
    await syncItem(enrollment.external_item_id);
  } catch (syncError) {
    // The next SYNC_UPDATES_AVAILABLE webhook resumes from the saved cursor.
    console.error("Failed to sync after reconnecting", syncError);
  }

  return NextResponse.json({ success: true });
}
