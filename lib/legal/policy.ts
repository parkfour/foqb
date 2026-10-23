import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth/current-user";

import { POLICY_VERSION } from "./policy-version";

export { POLICY_VERSION };

export const ACCEPT_TERMS_PATH = "/accept-terms";

// Whether the signed-in user has accepted the current policy version.
export async function hasAcceptedCurrentPolicies(): Promise<boolean> {
  const user = await getAuthUser();
  if (!user) return false;
  const supabase = await createClient();

  const { data } = await supabase
    .from("policy_acceptances")
    .select("version")
    .eq("user_id", user.id)
    .eq("version", POLICY_VERSION)
    .maybeSingle();

  return data !== null;
}

// For the app's layouts: nothing inside renders until the current
// policies have been accepted.
export async function requireCurrentPolicyAcceptance(): Promise<void> {
  if (!(await hasAcceptedCurrentPolicies())) {
    redirect(ACCEPT_TERMS_PATH);
  }
}
