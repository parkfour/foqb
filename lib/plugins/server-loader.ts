// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { serverPluginParts } from "@/plugins/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSiteSettings, type PluginSiteMode } from "@/lib/site/settings";
import { on } from "./hooks";
import { enabledPluginIds, ensurePluginsLoaded } from "./loader";
import type { BankCategorizer, ExchangeRate, HookEvent, PluginJob, ServerPluginParts } from "./types";

// Older than this, a quote isn't used. Reference rates skip weekends and
// holidays, so a few days old is normal.
export const MAX_RATE_AGE_DAYS = 7;

let loaded = false;

// The site's plugin modes, read at most every 30 seconds per process: an
// event, a job run and each new bank transaction ask.
const MODES_CACHE_MS = 30_000;
let cachedModes: { until: number; modes: Record<string, PluginSiteMode> } | null = null;

async function siteModes(): Promise<Record<string, PluginSiteMode>> {
  if (cachedModes && cachedModes.until > Date.now()) return cachedModes.modes;
  try {
    const { pluginModes } = await getSiteSettings(createAdminClient());
    cachedModes = { until: Date.now() + MODES_CACHE_MS, modes: pluginModes };
    return pluginModes;
  } catch (err) {
    // Unreadable (no database yet, or a test): nothing is switched off.
    console.error("Couldn't read the site's plugin modes", err);
    return {};
  }
}

// The plugins the instance runs that the site hasn't turned off: the ones
// whose server parts run.
export async function runningPluginIds(
  enabledIds: string[] = enabledPluginIds(),
  modes?: Record<string, PluginSiteMode>,
): Promise<string[]> {
  const site = modes ?? (await siteModes());
  return enabledIds.filter((id) => site[id] !== "off");
}

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
      if (!handler) continue;
      // Registered once, so the site's switch is checked at each event.
      on(event as HookEvent, async (payload: unknown) => {
        if ((await siteModes())[id] === "off") return;
        await (handler as (payload: unknown) => Promise<void>)(payload);
      });
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

// The first usable quote an enabled plugin gives, or null: without one, a
// book in another currency is left out rather than guessed at.
export async function exchangeRate(
  from: string,
  to: string,
  enabledIds: string[] = enabledPluginIds(),
  parts: Record<string, ServerPluginParts> = serverPluginParts,
  now: Date = new Date(),
): Promise<ExchangeRate | null> {
  const oldest = new Date(now.getTime() - MAX_RATE_AGE_DAYS * 86_400_000).toISOString().slice(0, 10);
  for (const id of enabledIds) {
    const source = parts[id]?.exchangeRates;
    if (!source) continue;
    try {
      const quote = await source.rate(from, to);
      if (quote && Number.isFinite(quote.rate) && quote.rate > 0 && quote.asOf >= oldest) return quote;
    } catch {
      // A source that fails is skipped, like one with no quote.
    }
  }
  return null;
}

// For tests.
export function resetServerLoaderState(): void {
  loaded = false;
  cachedModes = null;
}
