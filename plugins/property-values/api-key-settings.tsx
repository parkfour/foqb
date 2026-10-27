// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useActionState, useEffect, useState, useTransition, type ReactNode } from "react";
import type { SlotComponent } from "@/lib/plugins/types";
import { getApiKeyStatus, removeApiKey, saveApiKey, type ActionResult } from "./actions";
import type { ApiKeyName } from "./server";
import { FRED_NOTICE, FRED_TERMS_URL } from "./values-section";

const link = (href: string, text: string) => (
  <a href={href} target="_blank" rel="noreferrer" className="underline">
    {text}
  </a>
);

const KEYS: { name: ApiKeyName; title: string; placeholder: string; about: ReactNode; footer?: ReactNode }[] = [
  {
    name: "fred",
    title: "FRED API key (house price index)",
    placeholder: "32 letters and digits",
    about: (
      <>
        The house price index comes from FRED, the St. Louis Fed&rsquo;s data service. A key is free: sign in at{" "}
        {link("https://fredaccount.stlouisfed.org/apikeys", "fredaccount.stlouisfed.org/apikeys")} and request one. You can use
        the same key in each of your books; someone else keeping books here should get their own.
      </>
    ),
    footer: (
      <>
        {FRED_NOTICE} {link(FRED_TERMS_URL, "Terms of use")}.
      </>
    ),
  },
  {
    name: "rentcast",
    title: "RentCast API key (market estimate)",
    placeholder: "From your RentCast API dashboard",
    about: (
      <>
        A weekly estimate from nearby sales, from RentCast. Sign up at {link("https://www.rentcast.io/api", "rentcast.io/api")} and create a key in its dashboard.
        Its free plan includes 50 lookups a month and charges for each one past that, so each property is looked up at most once a
        week, up to the monthly limit set above. A key used in more than one book counts each book&rsquo;s lookups. Addresses are
        sent to RentCast.
      </>
    ),
  },
];

function KeyCard({
  organizationId,
  spec,
  isOwner,
  saved,
  onChange,
}: {
  organizationId: string;
  spec: (typeof KEYS)[number];
  isOwner: boolean;
  saved: boolean;
  onChange: () => void;
}) {
  const [result, saveAction, isSaving] = useActionState(saveApiKey, null);
  const [removed, setRemoved] = useState<ActionResult | null>(null);
  const [isRemoving, startRemove] = useTransition();
  useEffect(() => {
    if (result || removed) onChange();
  }, [result, removed, onChange]);
  const shown = result ?? removed;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">{spec.title}</h2>
      <p className="mt-1 text-xs text-slate-500">{spec.about}</p>
      {!isOwner ? (
        <p className="mt-3 text-sm text-slate-700">{saved ? "Set up." : "Not set up. An owner can add the key here."}</p>
      ) : (
        <form key={String(saved)} action={saveAction} className="mt-3 flex max-w-xl flex-col gap-3">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="keyName" value={spec.name} />
          <label className="flex flex-col gap-1 text-sm text-slate-700">
            Key {saved && <span className="text-xs text-slate-500">(saved; paste a new one to replace it)</span>}
            <input name="apiKey" autoComplete="off" placeholder={spec.placeholder} className="rounded-md border border-slate-300 px-3 py-2 text-sm font-mono" />
          </label>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={isSaving}
              className="w-fit rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {isSaving ? "Saving…" : "Save"}
            </button>
            {saved && (
              <button
                type="button"
                disabled={isRemoving}
                onClick={() => startRemove(async () => setRemoved(await removeApiKey(organizationId, spec.name)))}
                className="text-sm text-slate-500 hover:text-red-600"
              >
                Remove
              </button>
            )}
          </div>
          {shown &&
            ("error" in shown ? (
              <p className="rounded-md bg-red-50 p-2 text-xs text-red-700">{shown.error}</p>
            ) : (
              <p className="rounded-md bg-emerald-50 p-2 text-xs text-emerald-800">{shown.message}</p>
            ))}
        </form>
      )}
      {spec.footer && <p className="mt-3 text-xs text-slate-500">{spec.footer}</p>}
    </div>
  );
}

export const ApiKeySettings: SlotComponent<"settings.sections"> = ({ context }) => {
  const { organizationId } = context;
  const [status, setStatus] = useState<Awaited<ReturnType<typeof getApiKeyStatus>>>(null);
  const [version, setVersion] = useState(0);
  const [onChange] = useState(() => () => setVersion((v) => v + 1));

  useEffect(() => {
    getApiKeyStatus(organizationId).then(setStatus, () => setStatus(null));
  }, [organizationId, version]);

  if (!status) return null;
  return (
    <div className="flex flex-col gap-4">
      {KEYS.map((spec) => (
        <KeyCard key={spec.name} organizationId={organizationId} spec={spec} isOwner={status.isOwner} saved={status.saved[spec.name]} onChange={onChange} />
      ))}
    </div>
  );
};
