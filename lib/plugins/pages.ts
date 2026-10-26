// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { availablePlugins } from "@/plugins";
import type { FOQBPlugin, PluginPage, PluginReport, WorkspaceType } from "./types";

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

// The enabled plugins' reports, for Financial Reports. A report's value
// there is plugin:<plugin id>:<report id>.
export interface PluginReportOption {
  value: string;
  label: string;
  range: boolean;
}

export function pluginReportOptions(
  workspaceType: WorkspaceType,
  enabledIds: string[],
  available: FOQBPlugin[] = availablePlugins,
): PluginReportOption[] {
  return available
    .filter((p) => enabledIds.includes(p.manifest.id))
    .flatMap((p) =>
      (p.reports ?? [])
        .filter((r) => SLUG.test(r.id) && (!r.workspace || r.workspace === workspaceType))
        .map((r) => ({ value: `plugin:${p.manifest.id}:${r.id}`, label: r.title, range: r.range })),
    );
}

export function findPluginReport(value: string, available: FOQBPlugin[] = availablePlugins): PluginReport | null {
  const [, pluginId, id] = value.split(":");
  return available.find((p) => p.manifest.id === pluginId)?.reports?.find((r) => r.id === id) ?? null;
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
