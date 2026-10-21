import type { AdminUserAttributes, SupabaseClient, UserResponse } from "@supabase/supabase-js";

// auth.admin.createUser, for accounts a Site Admin or org owner creates. With
// sign-ups disabled the database refuses any new auth user it wasn't told to
// expect, so record a one-time exemption for this email first; it's removed
// afterwards whether or not the account was created.
export async function adminCreateUser(
  admin: SupabaseClient,
  attributes: AdminUserAttributes & { email: string },
): Promise<UserResponse> {
  const email = attributes.email.toLowerCase();
  const { error } = await admin
    .from("signup_exemptions")
    .upsert({ email, created_at: new Date().toISOString() });
  if (error) {
    return { data: { user: null }, error } as unknown as UserResponse;
  }

  try {
    return await admin.auth.admin.createUser(attributes);
  } finally {
    await admin.from("signup_exemptions").delete().eq("email", email);
  }
}
