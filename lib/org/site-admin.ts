import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth/current-user";

// Site Admin is a property of the user identity itself, not a per-org
// role — orthogonal to organization_members.role. Backed by the
// site_admins table / is_site_admin() RLS helper (see the site_admin
// migration); this just surfaces that check for gating UI and routes.
export const isSiteAdmin = cache(async (): Promise<boolean> => {
  const user = await getAuthUser();
  if (!user) return false;
  const supabase = await createClient();

  const { data } = await supabase
    .from("site_admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  return data !== null;
});
