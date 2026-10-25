import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

// Instance-wide switches set from the Site Admin console (the single
// site_settings row). Readable by anyone, signed in or not.
export interface SiteSettings {
  signupsEnabled: boolean;
  bankLinkingEnabled: boolean;
  pluginModes: Record<string, PluginSiteMode>;
}

// Each plugin the instance runs (FOQB_PLUGINS), site-wide: hidden
// everywhere, off in a book until its owner turns it on, or on in every
// book until its owner turns it off. See 20260101000073_plugin_site_modes.sql.
export type PluginSiteMode = "off" | "choose" | "on";
export const PLUGIN_SITE_MODES: PluginSiteMode[] = ["off", "choose", "on"];

export function pluginSiteMode(modes: Record<string, PluginSiteMode>, pluginId: string): PluginSiteMode {
  return modes[pluginId] ?? "choose";
}

export async function getSiteSettings(supabase?: SupabaseClient): Promise<SiteSettings> {
  const client = supabase ?? (await createClient());
  const { data } = await client.from("site_settings").select("signups_enabled, bank_linking_enabled, plugin_modes").maybeSingle();
  const row = data as {
    signups_enabled: boolean;
    bank_linking_enabled: boolean;
    plugin_modes: Record<string, PluginSiteMode> | null;
  } | null;
  // Defaults match the column defaults; the database enforces the real value
  // either way (see 20260101000043_site_settings_signups.sql and
  // 20260101000044_bank_linking_switches.sql).
  return {
    signupsEnabled: row?.signups_enabled ?? true,
    bankLinkingEnabled: row?.bank_linking_enabled ?? true,
    pluginModes: row?.plugin_modes ?? {},
  };
}

export const SIGNUPS_CLOSED = "Sign-ups are closed on this instance. Ask an administrator for an account.";
