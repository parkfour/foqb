// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ServerPluginParts } from "@/lib/plugins/types";
import { deliverDueWebhooks, enqueueWebhookEvent } from "./delivery";
import { WEBHOOK_EVENTS, type WebhookEvent } from "./events";

// Every event a webhook can subscribe to is queued for the book's webhooks
// that asked for it.
export const webhooksServer: ServerPluginParts = {
  hooks: Object.fromEntries(
    (Object.keys(WEBHOOK_EVENTS) as WebhookEvent[]).map((event) => [event, (payload: { orgId: string }) => enqueueWebhookEvent(event, payload)]),
  ),
  jobs: [{ name: "webhook-deliveries", minIntervalSeconds: 60, run: deliverDueWebhooks }],
};
