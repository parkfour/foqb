// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from "vitest";

const { enqueueMock } = vi.hoisted(() => ({ enqueueMock: vi.fn() }));
vi.mock("@/plugins/webhooks/delivery", () => ({ enqueueWebhookEvent: enqueueMock, deliverDueWebhooks: vi.fn() }));

import { webhooksServer } from "@/plugins/webhooks/server";
import { WEBHOOK_EVENTS } from "@/plugins/webhooks/events";

describe("webhook events", () => {
  it("queues every event a webhook can subscribe to", async () => {
    const events = Object.keys(WEBHOOK_EVENTS);
    expect(Object.keys(webhooksServer.hooks ?? {}).sort()).toEqual([...events].sort());

    for (const event of events) {
      const payload = { orgId: "org-1", id: event };
      await (webhooksServer.hooks as Record<string, (p: unknown) => Promise<void>>)[event](payload);
      expect(enqueueMock).toHaveBeenLastCalledWith(event, payload);
    }
  });

  it("starts only the busy events unticked", () => {
    expect(Object.entries(WEBHOOK_EVENTS).filter(([, e]) => !e.byDefault).map(([name]) => name)).toEqual([
      "journal_entry:posted",
      "bank_transaction:imported",
    ]);
  });
});
