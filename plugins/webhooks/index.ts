// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FOQBPlugin } from "@/lib/plugins/types";
import { WebhookSettings } from "./webhook-settings";

// The event handlers and the retry job are server-only: plugins/server.ts.
export const webhooksPlugin: FOQBPlugin = {
  manifest: {
    id: "webhooks",
    name: "Webhooks",
    version: "0.1.0",
    description: "POST a signed JSON message to an owner's URL when invoices, bills and payments are recorded.",
    requiredEnv: ["ENCRYPTION_KEY"],
  },
  slots: { "settings.sections": WebhookSettings },
};
