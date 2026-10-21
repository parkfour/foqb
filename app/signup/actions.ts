"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { POLICY_VERSION } from "@/lib/legal/policy";
import { isEmailAllowed } from "@/lib/auth/signup-allowlist";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { getClientIp } from "@/lib/http/proxy-headers";
import { getSiteSettings, SIGNUPS_CLOSED } from "@/lib/site/settings";

export async function signup(formData: FormData): Promise<void> {
  if (!(await getSiteSettings()).signupsEnabled) {
    redirect(`/signup?error=${encodeURIComponent(SIGNUPS_CLOSED)}`);
  }

  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  if (formData.get("acceptPolicies") !== "on") {
    redirect(`/signup?error=${encodeURIComponent("Please agree to the Terms of Service and Privacy Policy to sign up.")}`);
  }

  const headersList = await headers();
  const ip = getClientIp(headersList);

  const ipOk = await checkRateLimit("signup:ip", ip, 5, 60 * 60);
  if (!ipOk) {
    redirect(`/signup?error=${encodeURIComponent("Too many attempts. Please wait a while and try again.")}`);
  }

  if (!isEmailAllowed(email, process.env.SIGNUP_ALLOWLIST)) {
    redirect(`/signup?error=${encodeURIComponent("Signups are currently limited to specific accounts on this instance.")}`);
  }

  const supabase = await createClient();
  const origin = headersList.get("origin");

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${origin}/auth/callback` },
  });

  if (error) {
    redirect(`/signup?error=${encodeURIComponent(error.message)}`);
  }

  // Recorded with the service client: until the email is confirmed there's
  // no session to insert as. If this fails, the user is simply asked to
  // agree again on /accept-terms at first sign-in — never let in without it.
  if (data.user) {
    const { error: consentError } = await createAdminClient()
      .from("policy_acceptances")
      .upsert(
        { user_id: data.user.id, version: POLICY_VERSION },
        { onConflict: "user_id,version", ignoreDuplicates: true },
      );
    if (consentError) console.error("Failed to record policy acceptance at signup", consentError);
  }

  redirect("/signup?message=Check your email to confirm your account");
}
