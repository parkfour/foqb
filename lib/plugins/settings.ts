// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SupabaseClient } from "@supabase/supabase-js";
import { availablePlugins } from "@/plugins";
import { isPluginEnabled } from "./loader";
import { getSiteSettings, pluginSiteMode, type PluginSiteMode } from "@/lib/site/settings";
import type { FOQBPlugin, OrgPluginConfig, PluginSettingDefinition, PluginSettingValue } from "./types";

// FOQB's own key among the plugin's: a plugin's getPluginData keys are its
// own choice, and "config" is an obvious one.
export const PLUGIN_CONFIG_KEY = "foqb:config";

type Settings = Record<string, PluginSettingValue>;
type StoredConfig = { enabled?: boolean; settings?: Settings };

// Finds a plugin's settings schema from its definition or manifest
export function getPluginSettingDefinitions(plugin: FOQBPlugin): PluginSettingDefinition[] {
  return plugin.settings ?? plugin.manifest.settings ?? [];
}

// Computes the default values for a plugin based on its schema
export function getDefaultPluginSettings(plugin: FOQBPlugin): Settings {
  const defaults: Settings = {};
  for (const def of getPluginSettingDefinitions(plugin)) {
    if (def.defaultValue !== undefined) {
      defaults[def.key] = def.defaultValue;
    } else if (def.type === "multiselect") {
      defaults[def.key] = [];
    } else if (def.type === "boolean") {
      defaults[def.key] = false;
    } else if (def.type === "number") {
      defaults[def.key] = 0;
    } else {
      defaults[def.key] = "";
    }
  }
  return defaults;
}

// Merges stored settings with the plugin schema defaults
export function mergeSettingsWithDefaults(
  stored: Settings | null | undefined,
  plugin: FOQBPlugin,
): Settings {
  const defaults = getDefaultPluginSettings(plugin);
  const result: Settings = { ...defaults };
  if (!stored) return result;

  for (const def of getPluginSettingDefinitions(plugin)) {
    if (stored[def.key] !== undefined && stored[def.key] !== null) {
      result[def.key] = stored[def.key];
    }
  }
  // Also keep any custom plugin keys that were stored
  for (const [k, v] of Object.entries(stored)) {
    if (result[k] === undefined) {
      result[k] = v;
    }
  }
  return result;
}

type Modes = Record<string, PluginSiteMode>;

// The site's mode for each plugin, unless the caller has them.
async function modesOr(supabase: SupabaseClient, modes: Modes | undefined): Promise<Modes> {
  return modes ?? (await getSiteSettings(supabase)).pluginModes;
}

// Whether a plugin the instance runs is on for a book: never when the site
// turned it off; otherwise the book's own choice, or else the site's
// default ("on", or "choose", which starts off).
function resolveConfig(
  plugin: FOQBPlugin,
  row: { value: StoredConfig; updated_at?: string } | undefined,
  mode: PluginSiteMode,
): OrgPluginConfig {
  const byDefault = mode === "on";
  if (!row?.value) return { enabled: mode !== "off" && byDefault, settings: getDefaultPluginSettings(plugin) };
  return {
    enabled: mode !== "off" && (typeof row.value.enabled === "boolean" ? row.value.enabled : byDefault),
    settings: mergeSettingsWithDefaults(row.value.settings, plugin),
    updatedAt: row.updated_at,
  };
}

// Resolves a single plugin's config for an organization. A plugin the
// instance doesn't run is off for every book.
export async function getOrgPluginConfig(
  supabase: SupabaseClient,
  orgId: string,
  pluginId: string,
  available: FOQBPlugin[] = availablePlugins,
  modes?: Modes,
): Promise<OrgPluginConfig> {
  const plugin = available.find((p) => p.manifest.id === pluginId);
  if (!plugin || !isPluginEnabled(plugin.manifest.id, plugin.manifest.enabledByDefault)) {
    return { enabled: false, settings: plugin ? getDefaultPluginSettings(plugin) : {} };
  }

  const { data, error } = await supabase
    .from("plugin_data")
    .select("value, updated_at")
    .eq("organization_id", orgId)
    .eq("plugin_id", pluginId)
    .eq("key", PLUGIN_CONFIG_KEY)
    .maybeSingle();
  if (error) throw new Error(error.message);

  const mode = pluginSiteMode(await modesOr(supabase, modes), pluginId);
  return resolveConfig(plugin, (data as { value: StoredConfig; updated_at?: string } | null) ?? undefined, mode);
}

// Gets configs for all instance-available plugins for an organization
export async function getAllOrgPluginConfigs(
  supabase: SupabaseClient,
  orgId: string,
  available: FOQBPlugin[] = availablePlugins,
  modes?: Modes,
): Promise<Record<string, OrgPluginConfig>> {
  const siteModes = await modesOr(supabase, modes);
  const { data, error } = await supabase
    .from("plugin_data")
    .select("plugin_id, value, updated_at")
    .eq("organization_id", orgId)
    .eq("key", PLUGIN_CONFIG_KEY);
  if (error) throw new Error(error.message);

  const rows = new Map(
    ((data as { plugin_id: string; value: StoredConfig; updated_at?: string }[] | null) ?? []).map((r) => [r.plugin_id, r]),
  );
  const result: Record<string, OrgPluginConfig> = {};
  for (const plugin of available) {
    const id = plugin.manifest.id;
    if (isPluginEnabled(id, plugin.manifest.enabledByDefault)) {
      result[id] = resolveConfig(plugin, rows.get(id), pluginSiteMode(siteModes, id));
    }
  }
  return result;
}

// Saves plugin config for an organization
export async function setOrgPluginConfig(
  supabase: SupabaseClient,
  orgId: string,
  pluginId: string,
  config: { enabled: boolean; settings?: Settings },
  available: FOQBPlugin[] = availablePlugins,
): Promise<void> {
  const plugin = available.find((p) => p.manifest.id === pluginId);
  if (!plugin) {
    throw new Error(`Plugin "${pluginId}" is not registered`);
  }

  const merged = mergeSettingsWithDefaults(config.settings, plugin);

  const { error } = await supabase.from("plugin_data").upsert(
    {
      organization_id: orgId,
      plugin_id: pluginId,
      key: PLUGIN_CONFIG_KEY,
      value: {
        enabled: config.enabled,
        settings: merged,
      },
    },
    { onConflict: "organization_id,plugin_id,key" },
  );

  if (error) throw new Error(error.message);
}

// Resolves which plugins are enabled for the organization
export async function getOrgEnabledPluginIds(
  supabase: SupabaseClient,
  orgId: string,
  available: FOQBPlugin[] = availablePlugins,
  modes?: Modes,
): Promise<string[]> {
  const configs = await getAllOrgPluginConfigs(supabase, orgId, available, modes);
  return Object.entries(configs)
    .filter(([, cfg]) => cfg.enabled)
    .map(([id]) => id);
}

// Convenience helper for plugins to read their settings for an organization
export async function getPluginSettings<T = Settings>(
  supabase: SupabaseClient,
  orgId: string,
  pluginId: string,
  available: FOQBPlugin[] = availablePlugins,
  modes?: Modes,
): Promise<T> {
  const config = await getOrgPluginConfig(supabase, orgId, pluginId, available, modes);
  return config.settings as T;
}
