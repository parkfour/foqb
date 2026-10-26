// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createAdminClient } from "@/lib/supabase/admin";
import { emitHook } from "./hooks";
import { ensureServerPluginsLoaded } from "./server-loader";
import type { HookEvent, HookEventMap } from "./types";

// The events the database records (20260101000097), handed to the plugins'
// handlers in order. Run as a piggyback job.
export const PLUGIN_EVENTS_INTERVAL_SECONDS = 60;
const BATCH = 200;
const MAX_BATCHES = 10;

interface Row {
  id: number;
  organization_id: string;
  event: HookEvent;
  payload: Record<string, unknown>;
}

export async function deliverPluginEvents(): Promise<{ delivered: number }> {
  const admin = createAdminClient();
  ensureServerPluginsLoaded();
  let delivered = 0;
  for (let i = 0; i < MAX_BATCHES; i++) {
    const { data, error } = await admin.rpc("claim_plugin_events", { p_limit: BATCH });
    if (error) throw error;
    const rows = ((data ?? []) as Row[]).sort((a, b) => a.id - b.id);
    for (const row of rows) {
      await emitHook(row.event, { ...row.payload, orgId: row.organization_id } as HookEventMap[typeof row.event]);
      delivered++;
    }
    if (rows.length < BATCH) break;
  }
  return { delivered };
}
