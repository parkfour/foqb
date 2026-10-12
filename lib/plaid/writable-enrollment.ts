import type { SupabaseClient } from "@supabase/supabase-js";
import { canWrite, type MemberRole } from "@/lib/org/current";

export interface WritableEnrollment {
  id: string;
  organization_id: string;
  external_item_id: string;
}

// The enrollment, if the signed-in user can see it (RLS) AND holds a writer
// role in its org — null otherwise. Shared by every route that acts on an
// existing bank connection.
export async function findWritableEnrollment(
  supabase: SupabaseClient,
  userId: string,
  enrollmentId: string,
): Promise<WritableEnrollment | null> {
  const { data: enrollment } = await supabase
    .from("enrollments")
    .select("id, organization_id, external_item_id")
    .eq("id", enrollmentId)
    .maybeSingle();
  if (!enrollment) return null;

  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", enrollment.organization_id)
    .eq("user_id", userId)
    .maybeSingle();

  return canWrite((membership?.role as MemberRole | undefined) ?? null)
    ? (enrollment as WritableEnrollment)
    : null;
}
