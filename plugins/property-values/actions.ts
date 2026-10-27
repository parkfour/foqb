// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canWrite, getCurrentUserRole } from "@/lib/org/current";
import { encryptToken } from "@/lib/crypto/token-encryption";
import { getOrgEnabledPluginIds, getPluginSettings } from "@/lib/plugins/settings";
import { deletePluginData, getPluginData, setPluginData } from "@/lib/plugins/data";
import { FRED_KEY } from "./fhfa";
import { RENTCAST_KEY } from "./rentcast";
import {
  API_KEYS,
  DEFAULT_RENTCAST_LIMIT,
  NOTE_BASES_KEY,
  PLUGIN_ID,
  VALUATIONS_KEY,
  newRun,
  valueBook,
  valueSource,
  type ApiKeyName,
  type ValueSource,
  type NoteBases,
  type PropertyValueSettings,
  type Valuation,
  type Valuations,
} from "./server";

export type ActionResult = { error: string } | { ok: true; message?: string };

// A book asks again at most this often; the weekly job does the rest.
const REFRESH_EVERY_MS = 5 * 60 * 1000;

export interface ValuesRow {
  kind: "property" | "note";
  id: string;
  name: string;
  // What was paid (a property) or the collateral's value when the loan was made (a note).
  base: number | null;
  baseDate: string | null;
  estimatedValue: number | null;
  valuation: Valuation | null;
}

export interface ValuesView {
  canWrite: boolean;
  hasFredKey: boolean;
  hasRentcastKey: boolean;
  showZillow: boolean;
  autoUpdate: boolean;
  source: ValueSource;
  refreshedAt: string | null;
  rentcast: { used: number; limit: number } | null;
  rows: ValuesRow[];
}

async function isOn(organizationId: string): Promise<boolean> {
  return (await getOrgEnabledPluginIds(createAdminClient(), organizationId)).includes(PLUGIN_ID);
}

export async function getPropertyValuesView(organizationId: string): Promise<ValuesView | null> {
  const role = await getCurrentUserRole(organizationId);
  if (!role || !(await isOn(organizationId))) return null;
  const writable = canWrite(role);
  const supabase = await createClient();
  const admin = createAdminClient();
  const [{ data: properties }, notes, valuations, bases, fredKey, rentcastKey, settings] = await Promise.all([
    supabase
      .from("properties")
      .select("id, name, purchase_price, purchase_date, estimated_value")
      .eq("organization_id", organizationId)
      .eq("kind", "real_estate")
      .order("name"),
    // Notes are for owners and accountants, as on the notes section.
    writable
      ? supabase.from("mortgage_notes").select("id, name, origination_date").eq("organization_id", organizationId).order("name")
      : Promise.resolve({ data: [] }),
    getPluginData<Valuations>(supabase, organizationId, PLUGIN_ID, VALUATIONS_KEY),
    getPluginData<NoteBases>(supabase, organizationId, PLUGIN_ID, NOTE_BASES_KEY),
    getPluginData<{ encrypted?: string }>(admin, organizationId, PLUGIN_ID, API_KEYS.fred),
    getPluginData<{ encrypted?: string }>(admin, organizationId, PLUGIN_ID, API_KEYS.rentcast),
    getPluginSettings<PropertyValueSettings>(admin, organizationId, PLUGIN_ID),
  ]);
  const items = valuations?.items ?? {};
  const source = valueSource(settings.source);
  const month = new Date().toISOString().slice(0, 7);
  return {
    canWrite: writable,
    hasFredKey: !!fredKey?.encrypted,
    hasRentcastKey: !!rentcastKey?.encrypted,
    showZillow: !!process.env.PROPERTY_VALUE_API_URL && (settings.showZillow === true || source === "zillow"),
    autoUpdate: settings.autoUpdate === true,
    source,
    refreshedAt: valuations?.refreshedAt ?? null,
    rentcast: rentcastKey?.encrypted
      ? {
          used: valuations?.rentcastMonth === month ? (valuations.rentcastUsed ?? 0) : 0,
          limit: Number.isFinite(settings.rentcastLimit) ? Number(settings.rentcastLimit) : DEFAULT_RENTCAST_LIMIT,
        }
      : null,
    rows: [
      ...(properties ?? []).map((p) => ({
        kind: "property" as const,
        id: p.id as string,
        name: p.name as string,
        base: p.purchase_price === null ? null : Number(p.purchase_price),
        baseDate: p.purchase_date as string | null,
        estimatedValue: p.estimated_value === null ? null : Number(p.estimated_value),
        valuation: items[`property:${p.id}`] ?? null,
      })),
      ...((notes.data ?? []) as { id: string; name: string; origination_date: string }[]).map((n) => ({
        kind: "note" as const,
        id: n.id,
        name: n.name,
        base: bases?.[n.id] ?? null,
        baseDate: n.origination_date,
        estimatedValue: null,
        valuation: items[`note:${n.id}`] ?? null,
      })),
    ],
  };
}

const KEY_SHAPES: Record<ApiKeyName, { pattern: RegExp; label: string; normalize: (k: string) => string }> = {
  fred: { pattern: FRED_KEY, label: "A FRED API key is 32 letters and digits", normalize: (k) => k.toLowerCase() },
  rentcast: { pattern: RENTCAST_KEY, label: "That doesn't look like a RentCast API key", normalize: (k) => k },
};
const isKeyName = (s: unknown): s is ApiKeyName => s === "fred" || s === "rentcast";

// For the Settings section. The keys never leave the server.
export async function getApiKeyStatus(organizationId: string): Promise<{ isOwner: boolean; saved: Record<ApiKeyName, boolean> } | null> {
  const role = await getCurrentUserRole(organizationId);
  if (!role) return null;
  const admin = createAdminClient();
  const [fred, rentcast] = await Promise.all(
    (["fred", "rentcast"] as const).map((k) => getPluginData<{ encrypted?: string }>(admin, organizationId, PLUGIN_ID, API_KEYS[k])),
  );
  return { isOwner: role === "owner", saved: { fred: !!fred?.encrypted, rentcast: !!rentcast?.encrypted } };
}

export async function saveApiKey(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const organizationId = formData.get("organizationId") as string;
  const name = formData.get("keyName");
  if (!isKeyName(name)) return { error: "Unknown key" };
  const shape = KEY_SHAPES[name];
  const key = shape.normalize(((formData.get("apiKey") as string) ?? "").trim());
  if ((await getCurrentUserRole(organizationId)) !== "owner") return { error: "Only an owner can set API keys" };
  if (!shape.pattern.test(key)) return { error: shape.label };
  await setPluginData(createAdminClient(), organizationId, PLUGIN_ID, API_KEYS[name], { encrypted: encryptToken(key) });
  return { ok: true, message: "Saved. Use Refresh values on Properties & Assets to value them now." };
}

export async function removeApiKey(organizationId: string, name: ApiKeyName): Promise<ActionResult> {
  if (!isKeyName(name)) return { error: "Unknown key" };
  if ((await getCurrentUserRole(organizationId)) !== "owner") return { error: "Only an owner can remove API keys" };
  await deletePluginData(createAdminClient(), organizationId, PLUGIN_ID, API_KEYS[name]);
  return { ok: true, message: "Removed." };
}

// A note's collateral value when the loan was made; null clears it.
export async function saveNoteBase(organizationId: string, noteId: string, value: number | null): Promise<ActionResult> {
  if (!canWrite(await getCurrentUserRole(organizationId))) return { error: "Only owners and accountants can change this" };
  if (value !== null && !(Number.isFinite(value) && value > 0 && value < 1e12)) return { error: "Enter the value in dollars" };
  const supabase = await createClient();
  const { data: note } = await supabase
    .from("mortgage_notes")
    .select("id")
    .eq("id", noteId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!note) return { error: "That note isn't in this book" };
  const bases = { ...((await getPluginData<NoteBases>(supabase, organizationId, PLUGIN_ID, NOTE_BASES_KEY)) ?? {}) };
  if (value === null) delete bases[noteId];
  else bases[noteId] = Math.round(value * 100) / 100;
  await setPluginData(supabase, organizationId, PLUGIN_ID, NOTE_BASES_KEY, bases);
  return { ok: true };
}

export async function refreshPropertyValues(organizationId: string): Promise<ActionResult> {
  if (!canWrite(await getCurrentUserRole(organizationId))) return { error: "Only owners and accountants can refresh values" };
  if (!(await isOn(organizationId))) return { error: "Property values is off in this book" };
  const admin = createAdminClient();
  const last = (await getPluginData<Valuations>(admin, organizationId, PLUGIN_ID, VALUATIONS_KEY))?.refreshedAt;
  if (last && Date.now() - Date.parse(last) < REFRESH_EVERY_MS) return { ok: true, message: "Refreshed a few minutes ago." };
  const { updated, missed } = await valueBook(admin, organizationId, newRun());
  return {
    ok: true,
    message: updated || missed ? `Refreshed. ${updated} estimated value${updated === 1 ? "" : "s"} replaced${missed ? `, ${missed} couldn't be valued` : ""}.` : "Refreshed.",
  };
}
