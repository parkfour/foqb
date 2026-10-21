// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { availablePlugins } from "@/plugins";
import type { FOQBPlugin, PluginPage, WorkspaceType } from "./types";

const SLUG = /^[a-z0-9-]{1,64}$/;

// An enabled plugin's page, if it has one by that slug for this kind of book.
export function findPluginPage(
  pluginId: string,
  slug: string,
  workspaceType: WorkspaceType,
  enabledIds: string[],
  available: FOQBPlugin[] = availablePlugins,
): PluginPage | null {
  if (!enabledIds.includes(pluginId) || !SLUG.test(slug)) return null;
  const page = available.find((p) => p.manifest.id === pluginId)?.pages?.find((p) => p.slug === slug);
  return page && (!page.workspace || page.workspace === workspaceType) ? page : null;
}

// The menu entries for the enabled plugins' pages.
export function pluginPageLinks(
  workspaceType: WorkspaceType,
  enabledIds: string[],
  available: FOQBPlugin[] = availablePlugins,
): { href: string; label: string }[] {
  return available
    .filter((p) => enabledIds.includes(p.manifest.id))
    .flatMap((p) =>
      (p.pages ?? [])
        .filter((page) => SLUG.test(page.slug) && (!page.workspace || page.workspace === workspaceType))
        .map((page) => ({ href: `/plugins/${p.manifest.id}/${page.slug}`, label: page.title })),
    );
}
