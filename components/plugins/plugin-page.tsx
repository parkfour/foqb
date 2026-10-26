// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { availablePlugins } from "@/plugins";
import type { PluginPageContext, PluginReportContext } from "@/lib/plugins/types";
import { findPluginReport } from "@/lib/plugins/pages";

// A plugin's page, found again in the browser: the server already checked
// that the plugin is enabled and has this page for this book.
export function PluginPageHost({ pluginId, slug, context }: { pluginId: string; slug: string; context: PluginPageContext }) {
  const page = availablePlugins.find((p) => p.manifest.id === pluginId)?.pages?.find((p) => p.slug === slug);
  if (!page) return null;
  const Page = page.component;
  return <Page context={context} />;
}

// A plugin's report, likewise checked by the server first.
export function PluginReportHost({ value, context }: { value: string; context: PluginReportContext }) {
  const report = findPluginReport(value);
  if (!report) return null;
  const Report = report.component;
  return <Report context={context} />;
}
