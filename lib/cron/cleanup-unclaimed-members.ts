import { createAdminClient } from "@/lib/supabase/admin";

// Owner-created accounts (see createMemberAccount in settings/actions.ts)
// that are never logged into expire after this many days, so a mistyped
// email or a credential hand-off that never happened doesn't leave a
// dangling, unreachable account behind indefinitely.
const EXPIRY_DAYS = 7;

interface PendingRow {
  id: string;
  user_id: string;
  created_at: string;
}

export interface CleanupUnclaimedMembersResult {
  checked: number;
  deleted: number;
  claimed: number;
}

export async function cleanupUnclaimedMembers(): Promise<CleanupUnclaimedMembersResult> {
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: pending, error } = await admin
    .from("pending_member_accounts")
    .select("id, user_id, created_at")
    .lt("created_at", cutoff);

  if (error) {
    throw new Error(error.message);
  }

  let deleted = 0;
  let claimed = 0;

  for (const row of (pending as PendingRow[] | null) ?? []) {
    const { data: userData } = await admin.auth.admin.getUserById(row.user_id);

    if (userData?.user && !userData.user.last_sign_in_at) {
      // Still unclaimed past the expiry window — remove the account.
      // organization_members cascades from the auth.users delete.
      // ponytail: if this row were somehow its org's last/second-to-last
      // owner, the owner-removal guard trigger would throw here and abort
      // this loop iteration uncaught — accepted as a rare edge case (an
      // unclaimed owner-role invite outliving every other owner) rather
      // than plumbing a bypass into a job that has no legitimate reason to
      // touch owner-count invariants.
      await admin.auth.admin.deleteUser(row.user_id);
      deleted++;
    } else {
      // Either logged in already, or the user record is gone for some
      // other reason — either way it's no longer "pending."
      claimed++;
    }

    await admin.from("pending_member_accounts").delete().eq("id", row.id);
  }

  return { checked: pending?.length ?? 0, deleted, claimed };
}
