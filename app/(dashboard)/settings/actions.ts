"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { adminCreateUser } from "@/lib/auth/admin-create-user";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { canWrite, getCurrentUserRole } from "@/lib/org/current";
import { generatePassword } from "@/lib/auth/generate-password";
import { removeItem } from "@/lib/plaid/client";
import { decryptToken } from "@/lib/crypto/token-encryption";
import { MAX_LOGO_BYTES } from "@/lib/org/logo";
import { instanceTimezone } from "@/lib/org/book-clock";
import { isValidCurrency } from "@/lib/money";

const MEMBER_CREATE_LIMIT = 20;

export interface MemberCredentialsState {
  error: string | null;
  credentials?: { email: string; password: string };
}

export async function disconnectEnrollment(formData: FormData): Promise<void> {
  const id = formData.get("id") as string;
  if (!id) return;

  const supabase = await createClient();
  const { data: enrollment } = await supabase
    .from("enrollments")
    .select("id, organization_id")
    .eq("id", id)
    .maybeSingle();

  // Checked before touching Plaid: removing the Item for a viewer (whose
  // status update below RLS would refuse) would leave an "active"
  // enrollment with nothing behind it.
  if (!enrollment || !canWrite(await getCurrentUserRole(enrollment.organization_id as string))) return;

  // The access token isn't readable with the user's own client (see
  // 20260101000037_hide_enrollment_access_token.sql).
  const { data: secret } = await createAdminClient()
    .from("enrollments")
    .select("access_token")
    .eq("id", id)
    .maybeSingle();

  if (secret) {
    try {
      await removeItem(decryptToken(secret.access_token as string));
    } catch (error) {
      console.error("Failed to remove Item at Plaid", error);
    }
  }

  await supabase
    .from("enrollments")
    .update({ status: "disconnected", disconnect_reason: "User disconnected" })
    .eq("id", id);

  revalidatePath("/settings");
}

// Creates the member's account directly (no email required — there's no
// SMTP configured, by design) with a generated password returned once for
// the owner to distribute themselves. Tracked in pending_member_accounts
// until they log in or the account expires unclaimed (see the cleanup
// cron at app/api/cron/cleanup-unclaimed-members).
export async function createMemberAccount(
  _prevState: MemberCredentialsState,
  formData: FormData,
): Promise<MemberCredentialsState> {
  const organizationId = formData.get("organizationId") as string;
  const email = (formData.get("email") as string)?.trim().toLowerCase();
  const role = formData.get("role") as string;

  if (!organizationId || !email || !role) {
    return { error: "Email and role are required" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "You must be signed in" };
  }

  const callerRole = await getCurrentUserRole(organizationId);
  if (callerRole !== "owner") {
    return { error: "Only an owner can create member accounts" };
  }

  // Anyone can become an owner (sign up, create an org), and creating an
  // account for an already-registered email necessarily fails — so cap how
  // fast one person can use that to probe which emails have accounts.
  if (!(await checkRateLimit("member-create:user", user.id, MEMBER_CREATE_LIMIT, 60 * 60))) {
    return { error: "Too many accounts created recently. Please try again later." };
  }

  const password = generatePassword();
  const admin = createAdminClient();

  const { data: created, error: createError } = await adminCreateUser(admin, {
    email,
    password,
    email_confirm: true,
    user_metadata: { created_via_invite: true },
  });

  if (createError || !created.user) {
    return { error: "Couldn't create an account for that email" };
  }

  const { error: memberError } = await admin.from("organization_members").insert({
    organization_id: organizationId,
    user_id: created.user.id,
    role,
  });

  if (memberError) {
    // Roll back the orphaned auth user rather than leave an unreachable
    // account behind with no org membership.
    await admin.auth.admin.deleteUser(created.user.id);
    return { error: memberError.message };
  }

  await admin.from("pending_member_accounts").insert({
    organization_id: organizationId,
    user_id: created.user.id,
    created_by: user.id,
  });

  revalidatePath("/settings");
  return { error: null, credentials: { email, password } };
}

// For when the first distribution attempt fails (wrong number, lost text,
// etc.) — doesn't touch pending_member_accounts, so the expiry clock keeps
// running from the original creation time, not from the regeneration.
export async function regenerateMemberPassword(
  _prevState: MemberCredentialsState,
  formData: FormData,
): Promise<MemberCredentialsState> {
  const organizationId = formData.get("organizationId") as string;
  const userId = formData.get("userId") as string;
  const email = formData.get("email") as string;

  if (!organizationId || !userId || !email) {
    return { error: "Missing required fields" };
  }

  const callerRole = await getCurrentUserRole(organizationId);
  if (callerRole !== "owner") {
    return { error: "Only an owner can regenerate a member's password" };
  }

  const admin = createAdminClient();

  // Only an unclaimed account this org created — otherwise an owner of any
  // org could reset the password of any user by id.
  const { data: pending } = await admin
    .from("pending_member_accounts")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();
  const { data: target } = await admin.auth.admin.getUserById(userId);

  if (!pending || !target?.user || target.user.last_sign_in_at) {
    return { error: "Only an unclaimed account created by this organization can be reset" };
  }

  const password = generatePassword();
  const { error } = await admin.auth.admin.updateUserById(userId, { password });

  if (error) {
    return { error: error.message };
  }

  return { error: null, credentials: { email: target.user.email ?? email, password } };
}

// Routed through remove_org_member_guarded rather than a plain delete —
// the DB trigger blocks removing an org's last/second-to-last owner
// without its owner-removal secret regardless of caller, but the app still
// needs a way to supply that secret in the same transaction as the delete.
export async function removeMember(formData: FormData): Promise<void> {
  const id = formData.get("id") as string;
  const secret = (formData.get("secret") as string) || null;
  if (!id) return;

  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_org_member_guarded", {
    p_member_id: id,
    p_secret: secret,
  });

  if (error) {
    redirect(`/settings?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/settings");
}

// See removeMember's comment — same guard, same reason to go through the
// RPC instead of a plain update.
export async function updateMemberRole(formData: FormData): Promise<void> {
  const id = formData.get("id") as string;
  const role = formData.get("role") as string;
  const secret = (formData.get("secret") as string) || null;
  if (!id || !role) return;

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_org_member_role_guarded", {
    p_member_id: id,
    p_role: role,
    p_secret: secret,
  });

  if (error) {
    redirect(`/settings?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/settings");
}

export async function setOwnerRemovalSecret(formData: FormData): Promise<void> {
  const organizationId = formData.get("organizationId") as string;
  const secret = (formData.get("secret") as string)?.trim();
  const secretConfirm = (formData.get("secretConfirm") as string)?.trim();
  if (!organizationId) return;

  if (!secret || secret.length < 8) {
    redirect(
      `/settings?error=${encodeURIComponent("The owner-removal secret must be at least 8 characters")}`,
    );
  }

  if (secret !== secretConfirm) {
    redirect(
      `/settings?error=${encodeURIComponent("The owner-removal secret and its confirmation don't match")}`,
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_owner_removal_secret", {
    p_org_id: organizationId,
    p_secret: secret,
  });

  if (error) {
    redirect(`/settings?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/settings");
}

// Owner-only, logged with the days it makes ambiguous (see migration 054).
export async function setOrganizationTimezone(formData: FormData): Promise<void> {
  const organizationId = formData.get("organizationId") as string;
  const timezone = (formData.get("timezone") as string)?.trim();
  if (!organizationId || !timezone) return;

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_organization_timezone", {
    p_org_id: organizationId,
    p_timezone: timezone,
    p_instance_default: instanceTimezone(),
  });

  if (error) {
    redirect(`/settings?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/", "layout");
}

// Owner-only. The database refuses a change once the book has entries.
export async function setOrganizationCurrency(formData: FormData): Promise<void> {
  const organizationId = formData.get("organizationId") as string;
  const currency = formData.get("currency") as string;
  if (!organizationId) return;
  if (!isValidCurrency(currency)) {
    redirect(`/settings?error=${encodeURIComponent("That isn't a currency code")}`);
  }
  if ((await getCurrentUserRole(organizationId)) !== "owner") {
    redirect(`/settings?error=${encodeURIComponent("Only an owner can change the book's currency")}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.from("organizations").update({ currency }).eq("id", organizationId);
  if (error) {
    redirect(`/settings?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/", "layout");
}

export async function updateOrganizationSettings(formData: FormData): Promise<void> {
  const organizationId = formData.get("organizationId") as string;
  if (!organizationId) return;

  const periodLockDate = (formData.get("periodLockDate") as string) || null;
  const inventoryEnabled = formData.get("inventoryEnabled") === "on";
  const useAccountCodes = formData.get("useAccountCodes") === "on";
  const taxForm = (formData.get("taxForm") as string) || "none";
  const arAccountId = (formData.get("arAccountId") as string) || null;
  const apAccountId = (formData.get("apAccountId") as string) || null;
  const taxPayableAccountId = (formData.get("taxPayableAccountId") as string) || null;
  const defaultTaxRateRaw = formData.get("defaultTaxRate") as string;
  const defaultTaxRate = defaultTaxRateRaw ? Number(defaultTaxRateRaw) : null;

  const supabase = await createClient();
  await supabase
    .from("organizations")
    .update({
      period_lock_date: periodLockDate,
      inventory_enabled: inventoryEnabled,
      use_account_codes: useAccountCodes,
      tax_form: taxForm,
      ar_account_id: arAccountId,
      ap_account_id: apAccountId,
      tax_payable_account_id: taxPayableAccountId,
      default_tax_rate: defaultTaxRate,
    })
    .eq("id", organizationId);

  revalidatePath("/settings");
}

// Owner-only (also enforced by a trigger on organizations): whether this
// org can connect or reconnect banks.
export async function setBankLinking(formData: FormData): Promise<void> {
  const organizationId = formData.get("organizationId") as string;
  if (!organizationId) return;

  if ((await getCurrentUserRole(organizationId)) !== "owner") {
    redirect(`/settings?error=${encodeURIComponent("Only an owner can change whether this organization can connect banks")}`);
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("organizations")
    .update({ bank_linking_enabled: formData.get("bankLinkingEnabled") === "on" })
    .eq("id", organizationId);

  if (error) {
    redirect(`/settings?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/settings");
}

export async function uploadOrganizationLogo(formData: FormData): Promise<void> {
  const organizationId = formData.get("organizationId") as string;
  const file = formData.get("file");
  if (!organizationId || !(file instanceof File)) return;

  if ((await getCurrentUserRole(organizationId)) !== "owner") {
    redirect(`/settings?error=${encodeURIComponent("Only an owner can change the organization logo")}`);
  }

  if (!file.type.startsWith("image/")) {
    redirect(`/settings?error=${encodeURIComponent("Logo must be an image file")}`);
  }

  if (file.size > MAX_LOGO_BYTES) {
    redirect(
      `/settings?error=${encodeURIComponent(`Logo must be under ${Math.floor(MAX_LOGO_BYTES / 1024)}KB`)}`,
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const dataUrl = `data:${file.type};base64,${buffer.toString("base64")}`;

  const supabase = await createClient();
  const { error } = await supabase
    .from("organizations")
    .update({ logo_data_url: dataUrl })
    .eq("id", organizationId);

  if (error) {
    redirect(`/settings?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/settings");
  revalidatePath("/", "layout");
}

export async function removeOrganizationLogo(formData: FormData): Promise<void> {
  const organizationId = formData.get("organizationId") as string;
  if (!organizationId) return;

  if ((await getCurrentUserRole(organizationId)) !== "owner") {
    redirect(`/settings?error=${encodeURIComponent("Only an owner can change the organization logo")}`);
  }

  const supabase = await createClient();
  await supabase.from("organizations").update({ logo_data_url: null }).eq("id", organizationId);

  revalidatePath("/settings");
  revalidatePath("/", "layout");
}
