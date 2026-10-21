"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/auth/rate-limit";

export async function verifyMfaChallenge(formData: FormData): Promise<void> {
  const factorId = formData.get("factorId") as string;
  const code = formData.get("code") as string;

  const supabase = await createClient();

  // A 6-digit TOTP code is brute-forceable without a limit here — key by
  // the already-AAL1-authenticated user, not IP, since that's the actual
  // account under attack.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const rateOk = await checkRateLimit("mfa-challenge:user", user?.id ?? "unknown", 10, 15 * 60);
  if (!rateOk) {
    redirect(
      `/login/mfa?error=${encodeURIComponent("Too many attempts. Please wait a few minutes and try again.")}`,
    );
  }

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });

  if (error) {
    redirect(`/login/mfa?error=${encodeURIComponent(error.message)}`);
  }

  redirect("/");
}
