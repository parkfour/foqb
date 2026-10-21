// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FOQBPlugin } from "@/lib/plugins/types";
import { StartupAssistant } from "./startup-assistant";

// The guard and the clean-up live in the database
// (20260101000059_startup_assistant.sql), on for a book until it's done.
export const startupAssistantPlugin: FOQBPlugin = {
  manifest: {
    id: "startup-assistant",
    name: "Start-up assistant",
    version: "0.1.0",
    description: "While a book is started from statements and bank feeds, keeps history from before each account's opening balance out of it.",
  },
  slots: { "reconcile.header": StartupAssistant },
};
