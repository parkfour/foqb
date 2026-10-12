"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { getClientIp } from "@/lib/http/proxy-headers";

export async function requestPasswordReset(formData: FormData): Promise<void> {
  const email = formData.get("email") as string;

  const headersList = await headers();
  const ip = getClientIp(headersList);

  // Both limits matter here: this endpoint sends real emails, so it's an
  // email-bombing vector against a target (per-email) as well as a plain
  // abuse vector (per-IP).
  const [ipOk, emailOk] = await Promise.all([
    checkRateLimit("forgot-password:ip", ip, 5, 60 * 60),
    checkRateLimit("forgot-password:email", (email || "").toLowerCase(), 3, 60 * 60),
  ]);
  if (!ipOk || !emailOk) {
    redirect(
      `/forgot-password?error=${encodeURIComponent("Too many attempts. Please wait a while and try again.")}`,
    );
  }

  const supabase = await createClient();
  const origin = headersList.get("origin");

  // Supabase returns success even for an unknown email — don't reveal
  // whether an account exists.
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=/reset-password`,
  });

  redirect("/forgot-password?message=Check your email for a password reset link");
}
