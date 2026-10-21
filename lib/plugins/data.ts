// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SupabaseClient } from "@supabase/supabase-js";

// A plugin's own values in a book (the plugin_data table), for plugins
// that can't add tables: a private plugin never ships a migration. Reads
// and writes go through the signed-in user's session, so a book's members
// can read them and only its writers can change them.

export async function getPluginData<T>(
  supabase: SupabaseClient,
  orgId: string,
  pluginId: string,
  key: string,
): Promise<T | null> {
  const { data, error } = await supabase
    .from("plugin_data")
    .select("value")
    .eq("organization_id", orgId)
    .eq("plugin_id", pluginId)
    .eq("key", key)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.value as T) ?? null;
}

export async function setPluginData(
  supabase: SupabaseClient,
  orgId: string,
  pluginId: string,
  key: string,
  value: unknown,
): Promise<void> {
  const { error } = await supabase
    .from("plugin_data")
    .upsert({ organization_id: orgId, plugin_id: pluginId, key, value }, { onConflict: "organization_id,plugin_id,key" });
  if (error) throw new Error(error.message);
}

export async function deletePluginData(supabase: SupabaseClient, orgId: string, pluginId: string, key: string): Promise<void> {
  const { error } = await supabase
    .from("plugin_data")
    .delete()
    .eq("organization_id", orgId)
    .eq("plugin_id", pluginId)
    .eq("key", key);
  if (error) throw new Error(error.message);
}
