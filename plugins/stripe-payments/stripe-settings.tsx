// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import type { SlotComponent } from "@/lib/plugins/types";
import { getStripeSetup, removeStripeSettings, saveStripeSettings, type ActionResult, type StripeSetup } from "./actions";

const inputClass = "rounded-md border border-slate-300 px-3 py-2 text-sm";

function Result({ result }: { result: ActionResult | null }) {
  if (!result) return null;
  return "error" in result ? (
    <p className="rounded-md bg-red-50 p-2 text-xs text-red-700">{result.error}</p>
  ) : (
    <p className="rounded-md bg-emerald-50 p-2 text-xs text-emerald-800">{result.message}</p>
  );
}

export const StripeSettings: SlotComponent<"settings.sections"> = ({ context }) => {
  const { organizationId } = context;
  const [setup, setSetup] = useState<StripeSetup | null>(null);
  const [saved, saveAction, isSaving] = useActionState(saveStripeSettings, null);
  const [removed, setRemoved] = useState<ActionResult | null>(null);
  const [isRemoving, startRemove] = useTransition();

  useEffect(() => {
    getStripeSetup(organizationId).then(setSetup, () => setSetup(null));
  }, [organizationId, saved, removed]);

  if (!setup) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">Stripe</h2>
      <p className="mt-1 text-xs text-slate-500">
        Invoices get a payment link customers pay by card. Each payment is recorded against its invoice in the account
        chosen here (a &ldquo;Stripe balance&rdquo; asset, say); book Stripe&rsquo;s fees and payouts from that account when
        you reconcile it.
      </p>

      {!setup.isOwner ? (
        <p className="mt-3 text-sm text-slate-700">{setup.configured ? "Set up." : "Not set up. An owner can set it up here."}</p>
      ) : (
        <form key={String(setup.configured)} action={saveAction} className="mt-3 grid max-w-xl grid-cols-1 gap-3">
          <input type="hidden" name="organizationId" value={organizationId} />
          <label className="flex flex-col gap-1 text-sm text-slate-700">
            Secret key {setup.configured && <span className="text-xs text-slate-500">(saved; leave blank to keep it)</span>}
            <input name="secretKey" autoComplete="off" placeholder="sk_live_… or rk_live_… (sk_test_… to try it out)" className={inputClass} />
            <span className="text-xs text-slate-500">
              A restricted key needs write access to Prices and Payment Links.
            </span>
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-700">
            Webhook signing secret{" "}
            {setup.hasWebhookSecret && <span className="text-xs text-slate-500">(saved; leave blank to keep it)</span>}
            <input name="webhookSecret" autoComplete="off" placeholder="whsec_…" className={inputClass} />
            <span className="text-xs text-slate-500">
              In Stripe, add a webhook endpoint for <code className="break-all">{setup.webhookUrl}</code> with the event{" "}
              <code>checkout.session.completed</code>, then paste its signing secret here.
            </span>
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-700">
            Payments go into
            <select name="depositAccountId" defaultValue={setup.depositAccountId ?? ""} required className={inputClass}>
              <option value="">Choose an asset account…</option>
              {setup.depositAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={isSaving}
              className="w-fit rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {isSaving ? "Saving…" : "Save"}
            </button>
            {setup.configured && (
              <button
                type="button"
                disabled={isRemoving}
                onClick={() => startRemove(async () => setRemoved(await removeStripeSettings(organizationId)))}
                className="text-sm text-slate-500 hover:text-red-600"
              >
                Remove
              </button>
            )}
          </div>
          <Result result={saved ?? removed} />
        </form>
      )}
    </div>
  );
};
