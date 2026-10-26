"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { adminCreateUser } from "@/lib/auth/admin-create-user";
import { isSiteAdmin } from "@/lib/org/site-admin";
import { getSiteSettings, PLUGIN_SITE_MODES, type PluginSiteMode } from "@/lib/site/settings";
import { enabledPluginIds } from "@/lib/plugins/loader";
import { availablePlugins } from "@/plugins";
import { generatePassword } from "@/lib/auth/generate-password";
import { removeItem } from "@/lib/plaid/client";
import { decryptToken } from "@/lib/crypto/token-encryption";
import type { ActionState } from "@/app/(dashboard)/actions";
import type { MemberCredentialsState } from "@/app/(dashboard)/settings/actions";

export async function suspendOrganization(formData: FormData): Promise<void> {
  const id = formData.get("id") as string;
  if (!id) return;

  const supabase = await createClient();
  await supabase.rpc("set_organization_status", { p_org_id: id, p_status: "suspended" });

  revalidatePath("/site-admin");
}

export async function unsuspendOrganization(formData: FormData): Promise<void> {
  const id = formData.get("id") as string;
  if (!id) return;

  const supabase = await createClient();
  await supabase.rpc("set_organization_status", { p_org_id: id, p_status: "active" });

  revalidatePath("/site-admin");
}

export async function deleteOrganization(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = formData.get("id") as string;
  if (!id) return { error: "Missing organization id" };

  // The database delete cascades away the org's bank enrollments — and with
  // them the only copy of each Plaid access token — but can't call Plaid.
  // So the tokens are read first (site admins only: the service client
  // bypasses RLS), and each Plaid Item is removed once the delete succeeds,
  // so no bank connection stays live (and billed) for a deleted org.
  if (!(await isSiteAdmin())) {
    return { error: "Only a Site Admin can delete an organization" };
  }
  const admin = createAdminClient();
  const { data: enrollments } = await admin
    .from("enrollments")
    .select("access_token")
    .eq("organization_id", id)
    .neq("status", "disconnected");

  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_organization", { p_org_id: id });

  if (error) {
    return { error: error.message };
  }

  for (const enrollment of (enrollments as { access_token: string }[] | null) ?? []) {
    try {
      await removeItem(decryptToken(enrollment.access_token));
    } catch (removeError) {
      console.error(`Failed to remove a Plaid Item for deleted organization ${id}`, removeError);
    }
  }

  revalidatePath("/site-admin");
  return { error: null };
}

// Mirrors createMemberAccount (app/(dashboard)/settings/actions.ts) almost
// exactly — admin-API account creation with a generated password shown
// once, no email required — just targeting site_admins instead of
// organization_members, and with no org association at all.
export async function createSiteAdminAccount(
  _prevState: MemberCredentialsState,
  formData: FormData,
): Promise<MemberCredentialsState> {
  const email = (formData.get("email") as string)?.trim().toLowerCase();
  if (!email) {
    return { error: "Email is required" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "You must be signed in" };
  }

  if (!(await isSiteAdmin())) {
    return { error: "Only a Site Admin can create Site Admin accounts" };
  }

  const password = generatePassword();
  const admin = createAdminClient();

  const { data: created, error: createError } = await adminCreateUser(admin, {
    email,
    password,
    email_confirm: true,
    user_metadata: { created_via_site_admin: true },
  });

  if (createError || !created.user) {
    return { error: createError?.message ?? "Failed to create account" };
  }

  const { error: siteAdminError } = await admin.from("site_admins").insert({
    user_id: created.user.id,
    granted_by: user.id,
  });

  if (siteAdminError) {
    // Roll back the orphaned auth user rather than leave an unreachable
    // account behind with no site-admin grant.
    await admin.auth.admin.deleteUser(created.user.id);
    return { error: siteAdminError.message };
  }

  await admin.from("pending_member_accounts").insert({
    user_id: created.user.id,
    created_by: user.id,
  });

  revalidatePath("/site-admin");
  return { error: null, credentials: { email, password } };
}

export async function demoteSiteAdmin(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const userId = formData.get("userId") as string;
  if (!userId) return { error: "Missing user id" };

  const supabase = await createClient();
  const { error } = await supabase.from("site_admins").delete().eq("user_id", userId);

  if (error) {
    // The last-site-admin-removal DB trigger surfaces here as a plain
    // Postgres exception message — readable enough to show directly rather
    // than needing a translation layer like deleteAccount's FK-violation
    // case (there's only one way this specific delete can fail).
    return { error: error.message };
  }

  revalidatePath("/site-admin");
  return { error: null };
}

// Each plugin's site-wide mode, from a select per plugin ("mode_<id>").
// Plugins the instance doesn't run now keep their saved mode, for when
// FOQB_PLUGINS names them again. The database checks the values.
export async function updatePluginSiteModes(formData: FormData): Promise<void> {
  if (!(await isSiteAdmin())) return;
  const supabase = await createClient();
  const modes = { ...(await getSiteSettings(supabase)).pluginModes };
  for (const id of enabledPluginIds()) {
    const mode = formData.get(`mode_${id}`);
    if (PLUGIN_SITE_MODES.includes(mode as PluginSiteMode)) modes[id] = mode as PluginSiteMode;
  }
  await supabase.from("site_settings").update({ plugin_modes: modes }).eq("id", true);

  revalidatePath("/site-admin");
  revalidatePath("/", "layout");
}

// RLS lets only Site Admins update site_settings; each change is logged to
// site_admin_actions by a trigger.
export async function updateSiteSettings(formData: FormData): Promise<void> {
  const supabase = await createClient();
  await supabase
    .from("site_settings")
    .update({
      signups_enabled: formData.get("signupsEnabled") === "on",
      bank_linking_enabled: formData.get("bankLinkingEnabled") === "on",
    })
    .eq("id", true);

  revalidatePath("/site-admin");
}

// A Site Admin acknowledging a plugin's disclaimer for the instance.
export async function acknowledgePluginForSite(formData: FormData): Promise<void> {
  const pluginId = formData.get("pluginId") as string;
  const plugin = availablePlugins.find((p) => p.manifest.id === pluginId);
  if (!plugin?.manifest.acknowledgement || formData.get("confirm") !== "on") return;

  const supabase = await createClient();
  const { error } = await supabase.rpc("acknowledge_plugin", {
    p_plugin_id: pluginId,
    p_version: plugin.manifest.acknowledgement.version,
    p_org_id: null,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/site-admin");
}
