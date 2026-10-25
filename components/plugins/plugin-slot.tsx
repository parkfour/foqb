// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { createContext, useContext, type ReactNode } from "react";
import { getSlotComponents } from "@/lib/plugins/hooks";
import { ensurePluginsLoaded } from "@/lib/plugins/loader";
import type { SlotContextMap, SlotName } from "@/lib/plugins/types";

// The plugins the server says are enabled (FOQB_PLUGINS isn't visible in
// the browser).
const EnabledPluginsContext = createContext<string[]>([]);

export function EnabledPluginsProvider({ ids, children }: { ids: string[]; children: ReactNode }) {
  return <EnabledPluginsContext.Provider value={ids}>{children}</EnabledPluginsContext.Provider>;
}

// A place in the UI where enabled plugins render their own controls.
// Renders nothing when no plugin uses the slot.
export function PluginSlot<K extends SlotName>({
  name,
  context,
  className = "flex items-center gap-2",
}: {
  name: K;
  context: SlotContextMap[K];
  className?: string;
}) {
  const enabledIds = useContext(EnabledPluginsContext);
  ensurePluginsLoaded(enabledIds);
  const components = getSlotComponents(name, enabledIds);
  if (components.length === 0) return null;

  return (
    <div className={className}>
      {components.map((Component, i) => (
        <Component key={i} context={context} />
      ))}
    </div>
  );
}
