import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export const CURRENT_ORG_COOKIE = "current_org_id";

export interface UserOrganization {
  id: string;
  name: string;
  logoDataUrl: string | null;
}

// Resolves the signed-in user's active organization: the org named by the
// current_org_id cookie if the user is actually a member of it (switched via
// the header's org switcher), otherwise their first membership.
export async function getCurrentOrgId(): Promise<string | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const cookieOrgId = (await cookies()).get(CURRENT_ORG_COOKIE)?.value;

  if (cookieOrgId) {
    const { data: membership } = await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", user.id)
      .eq("organization_id", cookieOrgId)
      .maybeSingle();

    if (membership) {
      return cookieOrgId;
    }
  }

  const { data: fallback } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  return (fallback?.organization_id as string | undefined) ?? null;
}

export type MemberRole = "owner" | "accountant" | "viewer";

// The signed-in user's role in the given org, for gating write UI —
// 'viewer' is read-only; 'owner'/'accountant' can write (matches the RLS
// split enforced by is_org_writer() in the database).
export async function getCurrentUserRole(orgId: string | null): Promise<MemberRole | null> {
  if (!orgId) return null;

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", orgId)
    .eq("user_id", user.id)
    .maybeSingle();

  return (data?.role as MemberRole | undefined) ?? null;
}

export function canWrite(role: MemberRole | null): boolean {
  return role === "owner" || role === "accountant";
}

// Whether this org shows/enters account numbers (QuickBooks-style "Use
// account numbers" preference, toggled from Settings). Defaults to true —
// the column itself defaults true in the schema, this just covers the
// no-org case the same way the other helpers here do.
export async function getUseAccountCodes(orgId: string | null): Promise<boolean> {
  if (!orgId) return true;

  const supabase = await createClient();
  const { data } = await supabase
    .from("organizations")
    .select("use_account_codes")
    .eq("id", orgId)
    .maybeSingle();

  return (data as { use_account_codes: boolean } | null)?.use_account_codes ?? true;
}

// A suspended org (Site Admin action) drops out of get_user_org_ids() for
// everyone except its owner — so this only ever resolves for a non-owner
// member of a suspended org as "not found" (they've lost access outright),
// while the owner can still see the status to show a proper banner.
export async function getOrgStatus(orgId: string | null): Promise<"active" | "suspended" | null> {
  if (!orgId) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("organizations")
    .select("status")
    .eq("id", orgId)
    .maybeSingle();

  return (data as { status: "active" | "suspended" } | null)?.status ?? null;
}

// All organizations the signed-in user belongs to, for the header's switcher.
export async function getUserOrganizations(): Promise<UserOrganization[]> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return [];

  const { data } = await supabase
    .from("organization_members")
    .select("organizations(id, name, logoDataUrl:logo_data_url)")
    .eq("user_id", user.id);

  const rows =
    (data as unknown as { organizations: UserOrganization | null }[] | null) ?? [];

  return rows.map((row) => row.organizations).filter((org): org is UserOrganization => org !== null);
}

