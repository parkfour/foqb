// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FOQBPlugin, HookEvent, HookEventMap, SlotComponent, SlotName } from "./types";

type Handler<K extends HookEvent> = (payload: HookEventMap[K]) => void | Promise<void>;

// One registry per runtime (the server, and each browser tab).
const listeners = new Map<HookEvent, Set<Handler<HookEvent>>>();
const slots = new Map<SlotName, SlotComponent<SlotName>[]>();
const plugins = new Map<string, FOQBPlugin>();

// How long one handler may hold up the request that emitted the event.
const HANDLER_TIMEOUT_MS = 5000;

export function on<K extends HookEvent>(event: K, handler: Handler<K>): () => void {
  const set = listeners.get(event) ?? new Set();
  listeners.set(event, set);
  set.add(handler as Handler<HookEvent>);
  return () => set.delete(handler as Handler<HookEvent>);
}

// Runs every handler for the event. A handler that throws or takes longer
// than HANDLER_TIMEOUT_MS is logged and skipped: the change the event
// reports is already saved, and a plugin must never fail it. Handlers with
// slow work should queue it rather than do it inline.
export async function emitHook<K extends HookEvent>(event: K, payload: HookEventMap[K]): Promise<void> {
  const handlers = [...(listeners.get(event) ?? [])];
  await Promise.all(
    handlers.map(async (handler) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          handler(payload),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`timed out after ${HANDLER_TIMEOUT_MS} ms`)), HANDLER_TIMEOUT_MS);
          }),
        ]);
      } catch (err) {
        console.error(`[plugins] "${event}" handler failed:`, err);
      } finally {
        clearTimeout(timer);
      }
    }),
  );
}

export function registerSlot<K extends SlotName>(slot: K, component: SlotComponent<K>): void {
  slots.set(slot, [...(slots.get(slot) ?? []), component as SlotComponent<SlotName>]);
}

export function getSlotComponents<K extends SlotName>(slot: K): SlotComponent<K>[] {
  return (slots.get(slot) ?? []) as SlotComponent<K>[];
}

export function registerPlugin(plugin: FOQBPlugin): void {
  const { id } = plugin.manifest;
  if (plugins.has(id)) return;
  plugins.set(id, plugin);

  for (const [event, handler] of Object.entries(plugin.hooks ?? {})) {
    if (handler) on(event as HookEvent, handler as Handler<HookEvent>);
  }
  for (const [slot, component] of Object.entries(plugin.slots ?? {})) {
    if (component) registerSlot(slot as SlotName, component as SlotComponent<SlotName>);
  }

  Promise.resolve()
    .then(() => plugin.init?.())
    .catch((err) => console.error(`[plugins] "${id}" failed to initialize:`, err));
}

export function getPlugins(): FOQBPlugin[] {
  return [...plugins.values()];
}

// For tests.
export function resetRegistry(): void {
  listeners.clear();
  slots.clear();
  plugins.clear();
}
