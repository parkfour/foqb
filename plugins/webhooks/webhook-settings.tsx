// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useActionState, useCallback, useEffect, useState, useTransition } from "react";
import type { SlotComponent } from "@/lib/plugins/types";
import { useBookClock } from "@/components/providers/book-clock-provider";
import { formatTimestamp } from "@/lib/time/book-time";
import {
  createWebhook,
  deleteWebhook,
  getWebhooks,
  sendTestWebhook,
  type TestResult,
  type Webhook,
  type WebhookDelivery,
} from "./actions";
import { WEBHOOK_EVENTS, type WebhookEvent } from "./events";

const EVENT_LABELS: Record<string, string> = Object.fromEntries(Object.entries(WEBHOOK_EVENTS).map(([e, { label }]) => [e, label]));

const STATUS_STYLES: Record<WebhookDelivery["status"], string> = {
  delivered: "text-emerald-700",
  pending: "text-amber-700",
  failed: "text-red-700",
};

function deliveryOutcome(d: WebhookDelivery): string {
  const answer = d.last_response_status ? `HTTP ${d.last_response_status}` : d.last_error;
  if (d.status === "delivered") return answer ?? "delivered";
  if (d.attempts === 0) return "queued";
  return `${answer ?? "no answer"} (attempt ${d.attempts}${d.status === "pending" ? ", will retry" : ""})`;
}

export const WebhookSettings: SlotComponent<"settings.sections"> = ({ context }) => {
  const { organizationId } = context;
  const { timeZone } = useBookClock();
  const [data, setData] = useState<{ webhooks: Webhook[]; deliveries: WebhookDelivery[] } | null>(null);
  const [created, createAction, isCreating] = useActionState(createWebhook, null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [isWorking, startWork] = useTransition();

  const refresh = useCallback(
    () => getWebhooks(organizationId).then(setData, () => setData(null)),
    [organizationId],
  );
  useEffect(() => {
    refresh();
  }, [refresh, created]);

  // Owners only.
  if (!data) return null;
  const urlOf = (id: string) => data.webhooks.find((w) => w.id === id)?.url ?? "(removed)";

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">Webhooks</h2>
      <p className="mt-1 text-xs text-slate-500">
        Sends a signed JSON message to your URL when something happens in this organization. Failed
        deliveries are retried for about 15 hours. See docs/PLUGINS.md for how to check the signature.
      </p>

      {data.webhooks.length > 0 && (
        <ul className="mt-3 flex flex-col divide-y divide-slate-100 text-sm">
          {data.webhooks.map((w) => (
            <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-900">{w.url}</p>
                <p className="text-xs text-slate-500">
                  {w.description ? `${w.description} · ` : ""}
                  {w.events.map((e) => EVENT_LABELS[e] ?? e).join(", ")}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={isWorking}
                  onClick={() =>
                    startWork(async () => {
                      setTestResult(await sendTestWebhook(organizationId, w.id));
                      await refresh();
                    })
                  }
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Send test
                </button>
                <button
                  type="button"
                  disabled={isWorking}
                  onClick={() =>
                    startWork(async () => {
                      await deleteWebhook(organizationId, w.id);
                      await refresh();
                    })
                  }
                  className="rounded-md px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {testResult && (
        <p
          className={`mt-2 rounded-md p-2 text-xs ${"error" in testResult ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}
        >
          {"error" in testResult ? testResult.error : testResult.message}
        </p>
      )}

      {created && "secret" in created && (
        <div className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
          <p>
            Added {created.url}. Its signing secret is shown only this once; copy it to the receiver now:
          </p>
          <code className="mt-1 block break-all rounded bg-white px-2 py-1 font-mono text-xs">{created.secret}</code>
        </div>
      )}

      <form action={createAction} className="mt-4 flex max-w-xl flex-col gap-3 text-sm">
        <input type="hidden" name="organizationId" value={organizationId} />
        <label className="flex flex-col gap-1 text-slate-700">
          URL
          <input
            name="url"
            type="url"
            required
            pattern="https://.*"
            placeholder="https://example.com/foqb-webhook"
            className="rounded-md border border-slate-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-slate-700">
          Description (optional)
          <input name="description" maxLength={200} className="rounded-md border border-slate-300 px-3 py-2" />
        </label>
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-slate-700">Events</legend>
          {Object.entries(EVENT_LABELS).map(([event, label]) => (
            <label key={event} className="flex items-center gap-2 text-slate-700">
              <input type="checkbox" name="events" value={event} defaultChecked={WEBHOOK_EVENTS[event as WebhookEvent].byDefault} />
              {label}
            </label>
          ))}
        </fieldset>
        {created && "error" in created && (
          <p className="rounded-md bg-red-50 p-2 text-xs text-red-700">{created.error}</p>
        )}
        <button
          type="submit"
          disabled={isCreating}
          className="w-fit rounded-md bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {isCreating ? "Adding…" : "Add webhook"}
        </button>
      </form>

      {data.deliveries.length > 0 && (
        <div className="mt-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recent deliveries</h3>
          <ul className="mt-2 flex flex-col gap-1 text-xs">
            {data.deliveries.map((d) => (
              <li key={d.id} className="flex flex-wrap gap-x-2">
                <span className="text-slate-500">{formatTimestamp(d.created_at, timeZone)}</span>
                <span className="font-medium text-slate-800">{d.event}</span>
                <span className="truncate text-slate-500">{urlOf(d.webhook_id)}</span>
                <span className={STATUS_STYLES[d.status]}>{deliveryOutcome(d)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
