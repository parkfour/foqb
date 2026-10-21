"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/auth/rate-limit";

export interface MfaEnrollState {
  error: string | null;
  factorId?: string;
  qrCode?: string;
  secret?: string;
}

export interface MfaVerifyState {
  error: string | null;
}

export async function enrollMfaFactor(): Promise<MfaEnrollState> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });

  if (error) {
    return { error: error.message };
  }

  return {
    error: null,
    factorId: data.id,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
  };
}

export async function verifyMfaEnrollment(
  _prevState: MfaVerifyState,
  formData: FormData,
): Promise<MfaVerifyState> {
  const factorId = formData.get("factorId") as string;
  const code = formData.get("code") as string;

  if (!factorId || !code) {
    return { error: "Enter the 6-digit code from your authenticator app" };
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const rateOk = await checkRateLimit("mfa-enroll:user", user?.id ?? "unknown", 10, 15 * 60);
  if (!rateOk) {
    return { error: "Too many attempts. Please wait a few minutes and try again." };
  }

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/settings");
  return { error: null };
}

export async function unenrollMfaFactor(formData: FormData): Promise<void> {
  const factorId = formData.get("factorId") as string;
  if (!factorId) return;

  const supabase = await createClient();
  await supabase.auth.mfa.unenroll({ factorId });

  revalidatePath("/settings");
}
