// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import type { SlotComponent } from "@/lib/plugins/types";
import {
  getMailSetup,
  removeMailServer,
  saveMailServer,
  sendTestEmail,
  type ActionResult,
  type MailSetup,
} from "./actions";

const inputClass = "rounded-md border border-slate-300 px-3 py-2 text-sm";

function Result({ result }: { result: ActionResult | null }) {
  if (!result) return null;
  return "error" in result ? (
    <p className="rounded-md bg-red-50 p-2 text-xs text-red-700">{result.error}</p>
  ) : (
    <p className="rounded-md bg-emerald-50 p-2 text-xs text-emerald-800">{result.message}</p>
  );
}

export const MailServerSettings: SlotComponent<"settings.sections"> = ({ context }) => {
  const { organizationId } = context;
  const [setup, setSetup] = useState<MailSetup | null>(null);
  const [saved, saveAction, isSaving] = useActionState(saveMailServer, null);
  const [other, setOther] = useState<ActionResult | null>(null);
  const [isWorking, startWork] = useTransition();

  useEffect(() => {
    getMailSetup(organizationId).then(setSetup, () => setSetup(null));
  }, [organizationId, saved]);

  if (!setup) return null;
  const { isOwner, server } = setup;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">Email</h2>
      <p className="mt-1 text-xs text-slate-500">
        Invoices are emailed through this organization&rsquo;s own mail server (SMTP). Port 465 uses
        TLS; any other port must support STARTTLS.
      </p>

      {!isOwner ? (
        <p className="mt-3 text-sm text-slate-700">
          {server ? `Sending from ${server.fromAddress} via ${server.host}.` : "Not set up. An owner can set it up here."}
        </p>
      ) : (
        // Keyed so the fields start over from what was saved.
        <form key={JSON.stringify(server)} action={saveAction} className="mt-3 grid max-w-xl grid-cols-1 gap-3 sm:grid-cols-2">
          <input type="hidden" name="organizationId" value={organizationId} />
          <label className="flex flex-col gap-1 text-sm text-slate-700">
            Server
            <input name="host" required placeholder="smtp.example.com" defaultValue={server?.host} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-700">
            Port
            <input name="port" type="number" required min={1} max={65535} defaultValue={server?.port ?? 587} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-700">
            User name
            <input name="username" required autoComplete="off" defaultValue={server?.username} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-700">
            Password
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              required={!server}
              placeholder={server ? "Unchanged" : undefined}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-700">
            Send from
            <input name="fromAddress" type="email" required defaultValue={server?.fromAddress} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-700">
            Replies to (optional)
            <input name="replyTo" type="email" defaultValue={server?.replyTo ?? ""} className={inputClass} />
          </label>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <button
              type="submit"
              disabled={isSaving}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {isSaving ? "Saving…" : "Save"}
            </button>
            {server && (
              <>
                <button
                  type="button"
                  disabled={isWorking}
                  onClick={() => startWork(async () => setOther(await sendTestEmail(organizationId)))}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Send me a test
                </button>
                <button
                  type="button"
                  disabled={isWorking}
                  onClick={() =>
                    startWork(async () => {
                      setOther(await removeMailServer(organizationId));
                      setSetup(await getMailSetup(organizationId));
                    })
                  }
                  className="rounded-md px-3 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  Remove
                </button>
              </>
            )}
          </div>
          <div className="sm:col-span-2">
            <Result result={saved} />
            <Result result={other} />
          </div>
        </form>
      )}
    </div>
  );
};
