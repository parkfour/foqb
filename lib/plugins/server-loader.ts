// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { serverPluginParts } from "@/plugins/server";
import { on } from "./hooks";
import { enabledPluginIds, ensurePluginsLoaded } from "./loader";
import type { BankCategorizer, HookEvent, PluginJob, ServerPluginParts } from "./types";

let loaded = false;

// Server code that emits events calls this first: it registers the enabled
// plugins, plus their server-only handlers.
export function ensureServerPluginsLoaded(
  enabledIds: string[] = enabledPluginIds(),
  parts: Record<string, ServerPluginParts> = serverPluginParts,
): void {
  ensurePluginsLoaded(enabledIds);
  if (loaded) return;
  loaded = true;
  for (const id of enabledIds) {
    for (const [event, handler] of Object.entries(parts[id]?.hooks ?? {})) {
      if (handler) on(event as HookEvent, handler as (payload: unknown) => Promise<void>);
    }
  }
}

export function enabledPluginJobs(
  enabledIds: string[] = enabledPluginIds(),
  parts: Record<string, ServerPluginParts> = serverPluginParts,
): PluginJob[] {
  return enabledIds.flatMap((id) => parts[id]?.jobs ?? []);
}

export function enabledCategorizers(
  enabledIds: string[] = enabledPluginIds(),
  parts: Record<string, ServerPluginParts> = serverPluginParts,
): BankCategorizer[] {
  return enabledIds.flatMap((id) => parts[id]?.categorizers ?? []);
}

// For tests.
export function resetServerLoaderState(): void {
  loaded = false;
}
