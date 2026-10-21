// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { availablePlugins } from "@/plugins";
import type { PluginPageContext } from "@/lib/plugins/types";

// A plugin's page, found again in the browser: the server already checked
// that the plugin is enabled and has this page for this book.
export function PluginPageHost({ pluginId, slug, context }: { pluginId: string; slug: string; context: PluginPageContext }) {
  const page = availablePlugins.find((p) => p.manifest.id === pluginId)?.pages?.find((p) => p.slug === slug);
  if (!page) return null;
  const Page = page.component;
  return <Page context={context} />;
}
