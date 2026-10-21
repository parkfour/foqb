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

let loaded = false;

// Registers the enabled plugins once per runtime; cheap to call anywhere.
export function ensurePluginsLoaded(
  enabledIds: string[] = enabledPluginIds(),
  available: FOQBPlugin[] = availablePlugins,
): void {
  if (loaded) return;
  loaded = true;
  for (const plugin of available) {
    if (enabledIds.includes(plugin.manifest.id)) registerPlugin(plugin);
  }
}

// For tests.
export function resetLoaderState(): void {
  loaded = false;
}
