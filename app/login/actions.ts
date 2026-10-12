"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { getClientIp } from "@/lib/http/proxy-headers";

const RATE_LIMIT_MESSAGE = "Too many attempts. Please wait a few minutes and try again.";

export async function login(formData: FormData): Promise<void> {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  const ip = getClientIp(await headers());

  // Two separate limits: per-IP catches a single attacker hammering many
  // accounts; per-email catches credential stuffing spread across many IPs
  // against one target account.
  const [ipOk, emailOk] = await Promise.all([
    checkRateLimit("login:ip", ip, 10, 15 * 60),
    checkRateLimit("login:email", (email || "").toLowerCase(), 5, 15 * 60),
  ]);
  if (!ipOk || !emailOk) {
    redirect(`/login?error=${encodeURIComponent(RATE_LIMIT_MESSAGE)}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  // A password sign-in alone only reaches AAL1. A user with a verified TOTP
  // factor must complete the challenge before the session is fully trusted.
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== aal.nextLevel) {
    redirect("/login/mfa");
  }

  redirect("/");
}
