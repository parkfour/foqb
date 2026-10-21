// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ServerPluginParts } from "@/lib/plugins/types";
import { deliverDueWebhooks, enqueueWebhookEvent } from "./delivery";

export const webhooksServer: ServerPluginParts = {
  hooks: {
    "invoice:created": (payload) => enqueueWebhookEvent("invoice:created", payload),
    "bill:created": (payload) => enqueueWebhookEvent("bill:created", payload),
    "invoice_payment:recorded": (payload) => enqueueWebhookEvent("invoice_payment:recorded", payload),
    "bill_payment:recorded": (payload) => enqueueWebhookEvent("bill_payment:recorded", payload),
  },
  jobs: [{ name: "webhook-deliveries", minIntervalSeconds: 60, run: deliverDueWebhooks }],
};
