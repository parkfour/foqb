import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hasPassedMfa, MFA_REQUIRED_FOR_BANKS } from "@/lib/auth/mfa";
import { findWritableEnrollment } from "@/lib/plaid/writable-enrollment";
import { syncItem } from "@/lib/plaid/sync";
import { bankLinkingBlockedReason } from "@/lib/plaid/bank-linking";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptToken } from "@/lib/crypto/token-encryption";
import { getAccounts } from "@/lib/plaid/client";
import { addLedgerAccounts } from "@/lib/plaid/ledger-accounts";

// Called after Plaid Link update mode succeeds: the Item's login works again
// (same Item, same ids — nothing to exchange), so mark it active, add a
// ledger account for any account newly shared (Add accounts), and catch
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

  // Before the sync: it skips the transactions of an account the book
  // doesn't have.
  const added = await addNewAccounts(supabase, enrollment.id, enrollment.organization_id);
  if (added) return NextResponse.json({ error: added }, { status: 500 });

  try {
    await syncItem(enrollment.external_item_id);
  } catch (syncError) {
    // The next SYNC_UPDATES_AVAILABLE webhook resumes from the saved cursor.
    console.error("Failed to sync after reconnecting", syncError);
  }

  return NextResponse.json({ success: true });
}

async function addNewAccounts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  enrollmentId: string,
  organizationId: string,
): Promise<string | null> {
  // Not readable with the user's own client (see
  // 20260101000037_hide_enrollment_access_token.sql).
  const admin = createAdminClient();
  const { data: secret } = await admin.from("enrollments").select("access_token").eq("id", enrollmentId).maybeSingle();
  if (!secret) return "Bank connection not found";
  const plaidAccounts = await getAccounts(decryptToken(secret.access_token as string));

  const { data: known } = await supabase
    .from("accounts")
    .select("external_account_id")
    .eq("organization_id", organizationId)
    .in(
      "external_account_id",
      plaidAccounts.map((a) => a.id),
    );
  const knownIds = new Set((known ?? []).map((a) => a.external_account_id as string));
  const error = await addLedgerAccounts(
    supabase,
    organizationId,
    plaidAccounts.filter((a) => !knownIds.has(a.id)),
  );
  if (error) return error;

  await admin
    .from("enrollments")
    .update({ account_masks: plaidAccounts.map((a) => a.mask).filter((mask): mask is string => !!mask) })
    .eq("id", enrollmentId);
  return null;
}
