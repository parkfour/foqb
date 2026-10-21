"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ACCEPT_TERMS_PATH, POLICY_VERSION } from "@/lib/legal/policy";

export async function acceptPolicies(formData: FormData): Promise<void> {
  if (formData.get("accept") !== "on") {
    redirect(`${ACCEPT_TERMS_PATH}?error=${encodeURIComponent("Please tick the box to agree before continuing.")}`);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Accepting the same version twice (a double-submit) is a no-op.
  const { error } = await supabase
    .from("policy_acceptances")
    .upsert({ user_id: user.id, version: POLICY_VERSION }, { onConflict: "user_id,version", ignoreDuplicates: true });

  if (error) {
    redirect(`${ACCEPT_TERMS_PATH}?error=${encodeURIComponent("Couldn't record your agreement. Please try again.")}`);
  }

  redirect("/");
}
