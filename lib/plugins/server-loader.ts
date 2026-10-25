// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { serverPluginParts } from "@/plugins/server";
import { on } from "./hooks";
import { enabledPluginIds, ensurePluginsLoaded } from "./loader";
import type { BankCategorizer, ExchangeRate, HookEvent, PluginJob, ServerPluginParts } from "./types";

// Older than this, a quote isn't used. Reference rates skip weekends and
// holidays, so a few days old is normal.
export const MAX_RATE_AGE_DAYS = 7;

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
}
