// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { serverPluginParts } from "@/plugins/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSiteSettings, type PluginSiteMode } from "@/lib/site/settings";
import { on } from "./hooks";
import { enabledPluginIds, ensurePluginsLoaded } from "./loader";
import { getOrgEnabledPluginIds } from "./settings";
import { ingestBankFeed } from "@/lib/bank/plugin-feed";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BankCategorizer,
  BankFeedSource,
  BookMail,
  ExchangeRate,
  HookEvent,
  InvoiceCheckInput,
  PluginJob,
  SalesTaxLookup,
  SecurityPrice,
  ServerPluginParts,
} from "./types";

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
  return enabledIds.flatMap((id) => {
    const feed = parts[id]?.bankFeed;
    return [
      ...(parts[id]?.jobs ?? []),
      ...(feed ? [{ name: `${id}-bank-feed`, minIntervalSeconds: feed.minIntervalSeconds, run: () => runBankFeed(id, feed, parts) }] : []),
    ];
  });
}

// The server parts of the plugins on in this book (the site's switch, the
// book's, and any acknowledgement each needs), in the instance's order.
export async function bookPluginParts(
  admin: SupabaseClient,
  organizationId: string,
  parts: Record<string, ServerPluginParts> = serverPluginParts,
): Promise<[string, ServerPluginParts][]> {
  // Skips the lookup when no plugin has a part to ask for.
  if (Object.keys(parts).length === 0) return [];
  try {
    const ids = await getOrgEnabledPluginIds(admin, organizationId);
    return ids.filter((id) => parts[id]).map((id) => [id, parts[id]]);
  } catch (err) {
    // Unreadable: no plugin is asked, as if none were on.
    console.error(`[plugins] Couldn't read which plugins book ${organizationId} has on`, err);
    return [];
  }
}

// Each book the plugin is on in, fetched and booked one at a time; one
// book's failure doesn't stop the rest.
// ponytail: asks every unsuspended book which plugins it has on; a query
// for just the books with this plugin on if instances grow large.
async function runBankFeed(
  pluginId: string,
  feed: BankFeedSource,
  parts: Record<string, ServerPluginParts>,
): Promise<{ books: number; failed: number }> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("organizations").select("id").is("suspended_at", null);
  if (error) throw error;
  let books = 0;
  let failed = 0;
  for (const { id } of (data ?? []) as { id: string }[]) {
    try {
      if (!(await bookPluginParts(admin, id, parts)).some(([p]) => p === pluginId)) continue;
      if (await ingestBankFeed(admin, pluginId, id, await feed.fetch(id))) books++;
    } catch (err) {
      failed++;
      console.error(`${feed.name} bank feed failed for book ${id}`, err);
    }
  }
  return { books, failed };
}

// Lines the book's plugins print at the foot of the invoice.
export async function invoiceNotes(
  admin: SupabaseClient,
  invoice: { id: string; organizationId: string; customerId: string | null },
  parts: Record<string, ServerPluginParts> = serverPluginParts,
): Promise<string[]> {
  const notes: string[] = [];
  for (const [id, p] of await bookPluginParts(admin, invoice.organizationId, parts)) {
    if (!p.invoiceNotes) continue;
    try {
      notes.push(...(await p.invoiceNotes(admin, invoice)).filter((n) => n.trim()));
    } catch (err) {
      console.error(`[plugins] "${id}" invoice notes failed:`, err);
    }
  }
  return notes;
}

// The first refusal from the book's plugins' checks, or null.
export async function checkInvoice(
  input: InvoiceCheckInput,
  parts: Record<string, ServerPluginParts> = serverPluginParts,
): Promise<string | null> {
  if (!Object.values(parts).some((p) => p.invoiceChecks?.length)) return null;
  let admin: SupabaseClient;
  try {
    admin = createAdminClient();
  } catch (err) {
    console.error("[plugins] No service-role client for invoice checks", err);
    return null;
  }
  for (const [id, p] of await bookPluginParts(admin, input.organizationId, parts)) {
    for (const check of p.invoiceChecks ?? []) {
      try {
        const refusal = await check(admin, input);
        if (refusal) return refusal;
      } catch (err) {
        console.error(`[plugins] "${id}" invoice check failed:`, err);
      }
    }
  }
  return null;
}

// Mail sent as the book, by the first plugin on in it whose mailer is set
// up. Callers check the user may send it.
export async function sendBookMail(
  admin: SupabaseClient,
  organizationId: string,
  mail: BookMail,
  parts: Record<string, ServerPluginParts> = serverPluginParts,
): Promise<{ sent: true } | { sent: false; reason: string }> {
  for (const [, p] of await bookPluginParts(admin, organizationId, parts)) {
    if (p.mailer && (await p.mailer.ready(organizationId))) {
      await p.mailer.send(organizationId, mail);
      return { sent: true };
    }
  }
  return { sent: false, reason: "This book has no way to send mail: turn on a plugin that sends it (Email invoices) and set it up." };
}

export async function bookCanSendMail(
  admin: SupabaseClient,
  organizationId: string,
  parts: Record<string, ServerPluginParts> = serverPluginParts,
): Promise<boolean> {
  for (const [, p] of await bookPluginParts(admin, organizationId, parts)) {
    if (p.mailer && (await p.mailer.ready(organizationId))) return true;
  }
  return false;
}

export async function salesTaxLookups(
  admin: SupabaseClient,
  organizationId: string,
  parts: Record<string, ServerPluginParts> = serverPluginParts,
): Promise<SalesTaxLookup[]> {
  return (await bookPluginParts(admin, organizationId, parts)).flatMap(([, p]) => (p.salesTaxLookup ? [p.salesTaxLookup] : []));
}

export function enabledCategorizers(
  enabledIds: string[] = enabledPluginIds(),
  parts: Record<string, ServerPluginParts> = serverPluginParts,
): BankCategorizer[] {
  return enabledIds.flatMap((id) => parts[id]?.categorizers ?? []);
}

// The first price an enabled plugin gives for a security's symbol, or null.
export async function securityPrice(
  symbol: string,
  enabledIds: string[] = enabledPluginIds(),
  parts: Record<string, ServerPluginParts> = serverPluginParts,
): Promise<SecurityPrice | null> {
  for (const id of enabledIds) {
    const source = parts[id]?.securityPrices;
    if (!source) continue;
    try {
      const quote = await source.price(symbol);
      if (quote && Number.isFinite(quote.price) && quote.price > 0) return quote;
    } catch {
      // A source that fails is skipped, like one with no quote.
    }
  }
  return null;
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
