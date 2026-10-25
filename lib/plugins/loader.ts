// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { availablePlugins } from "@/plugins";
import { registerPlugin } from "./hooks";
import type { FOQBPlugin } from "./types";

// FOQB_PLUGINS: unset or "*" runs the plugins that are on by default,
// "none" runs none, and "a,b" runs exactly those.
export function isPluginEnabled(pluginId: string, enabledByDefault = false): boolean {
  const setting = process.env.FOQB_PLUGINS?.trim();
  if (setting === "none") return false;
  if (!setting || setting === "*") return enabledByDefault;
  return setting
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .includes(pluginId.toLowerCase());
}

// Which plugins this instance runs. Server-only (it reads the
// environment); the dashboard layout passes the result to the browser.
export function enabledPluginIds(available: FOQBPlugin[] = availablePlugins): string[] {
  return available
    .filter((p) => isPluginEnabled(p.manifest.id, p.manifest.enabledByDefault))
    .map((p) => p.manifest.id);
}

const loaded = new Set<string>();

// Registers each enabled plugin once per runtime; cheap to call anywhere.
// Per id, not once overall: in the browser the list is the book's, and a
// plugin turned on in Settings has to show up without a reload.
export function ensurePluginsLoaded(
  enabledIds: string[] = enabledPluginIds(),
  available: FOQBPlugin[] = availablePlugins,
): void {
  for (const plugin of available) {
    const { id } = plugin.manifest;
    if (loaded.has(id) || !enabledIds.includes(id)) continue;
    loaded.add(id);
    registerPlugin(plugin);
  }
}

// For tests.
export function resetLoaderState(): void {
  loaded.clear();
}
