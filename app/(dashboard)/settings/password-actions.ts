"use server";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/auth/rate-limit";

export interface ChangePasswordState {
  error: string | null;
  done: boolean;
}

// The signed-in user's own password. The current one is checked first, so an
// unattended session can't be used to lock its owner out. It's checked on a
// throwaway client so this session (and its two-factor level) is untouched.
export async function changePassword(_prev: ChangePasswordState, formData: FormData): Promise<ChangePasswordState> {
  const current = formData.get("currentPassword") as string;
  const password = formData.get("password") as string;
  const confirm = formData.get("confirmPassword") as string;

  if (!password || password.length < 8) return { error: "The new password needs at least 8 characters", done: false };
  if (password !== confirm) return { error: "The new passwords don't match", done: false };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { error: "You're not signed in", done: false };

  if (!(await checkRateLimit("change-password", user.id, 5, 15 * 60))) {
    return { error: "Too many attempts. Please wait a few minutes and try again.", done: false };
  }

  const check = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: wrong } = await check.auth.signInWithPassword({ email: user.email, password: current });
  if (wrong) return { error: "The current password isn't right", done: false };
  await check.auth.signOut({ scope: "local" });

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message, done: false };
  return { error: null, done: true };
}
