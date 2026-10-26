import type { SupabaseClient } from "@supabase/supabase-js";
import { availablePlugins } from "@/plugins";
import { enabledPluginIds } from "./loader";
import type { FOQBPlugin } from "./types";

export interface AcknowledgementRecord {
  by: string | null;
  at: string;
}

export interface AcknowledgementStatus {
  site: AcknowledgementRecord | null;
  book: AcknowledgementRecord | null;
}

const gated = (plugins: FOQBPlugin[]) => plugins.filter((p) => p.manifest.acknowledgement);

// Each gated plugin's acknowledgements of its current disclaimer: the
// instance's and (with orgId) the book's.
export async function fetchAcknowledgements(
  supabase: SupabaseClient,
  orgId: string | null,
  plugins: FOQBPlugin[] = availablePlugins,
): Promise<Map<string, AcknowledgementStatus>> {
  const needing = gated(plugins);
  const out = new Map<string, AcknowledgementStatus>(needing.map((p) => [p.manifest.id, { site: null, book: null }]));
  if (needing.length === 0) return out;

  let query = supabase
    .from("plugin_acknowledgements")
    .select("organization_id, plugin_id, version, acknowledged_by, acknowledged_at")
    .in(
      "plugin_id",
      needing.map((p) => p.manifest.id),
    );
  query = orgId ? query.or(`organization_id.is.null,organization_id.eq.${orgId}`) : query.is("organization_id", null);
  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const versions = new Map(needing.map((p) => [p.manifest.id, p.manifest.acknowledgement!.version]));
  for (const row of (data ?? []) as {
    organization_id: string | null;
    plugin_id: string;
    version: string;
    acknowledged_by: string | null;
    acknowledged_at: string;
  }[]) {
    if (versions.get(row.plugin_id) !== row.version) continue;
    const status = out.get(row.plugin_id)!;
    const record = { by: row.acknowledged_by, at: row.acknowledged_at };
    if (row.organization_id === null) status.site = record;
    else if (row.organization_id === orgId) status.book = record;
  }
  return out;
}

export const isAcknowledged = (status: AcknowledgementStatus | undefined): boolean => !!status?.site && !!status?.book;

// The instance's plugins less the gated ones: what a page falls back to
// when a book's own plugin settings can't be read. A gated plugin never
// turns on by default.
export function ungatedPluginIds(plugins: FOQBPlugin[] = availablePlugins): string[] {
  const gatedIds = new Set(gated(plugins).map((p) => p.manifest.id));
  return enabledPluginIds().filter((id) => !gatedIds.has(id));
}
