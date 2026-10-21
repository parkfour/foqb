"use client";

import { useActionState, useEffect, useRef } from "react";
import { createOrganization, type ActionState } from "@/app/(dashboard)/actions";

const initialState: ActionState = { error: null };

export function CreateOrgForm() {
  const [state, formAction, isPending] = useActionState(createOrganization, initialState);
  // The new book starts in this device's timezone (changeable in Settings).
  // Filled in after hydration, so the server-rendered form doesn't differ.
  const timezoneRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (timezoneRef.current) timezoneRef.current.value = Intl.DateTimeFormat().resolvedOptions().timeZone;
  }, []);

  return (
    <div className="mx-auto max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-lg font-semibold text-slate-900">Create your organization</h1>
      <p className="mt-1 text-sm text-slate-500">
        You&apos;ll be the owner and can invite others later.
      </p>
      <form action={formAction} className="mt-4 flex flex-col gap-3">
        <input ref={timezoneRef} type="hidden" name="timezone" />
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-slate-700">Workspace Type</label>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 p-2.5 text-xs font-medium text-slate-800 hover:bg-slate-50 has-[:checked]:border-slate-900 has-[:checked]:bg-slate-50">
              <input
                type="radio"
                name="workspace_type"
                value="business"
                defaultChecked
                className="text-slate-900"
              />
              <div>
                <p className="font-semibold text-slate-900">Small Business</p>
                <p className="text-[11px] text-slate-500">Invoices, bills, inventory</p>
              </div>
            </label>
            <label className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 p-2.5 text-xs font-medium text-slate-800 hover:bg-slate-50 has-[:checked]:border-slate-900 has-[:checked]:bg-slate-50">
              <input
                type="radio"
                name="workspace_type"
                value="household"
                className="text-slate-900"
              />
              <div>
                <p className="font-semibold text-slate-900">Household</p>
                <p className="text-[11px] text-slate-500">Net worth, register, budget</p>
              </div>
            </label>
          </div>
        </div>
        <input
          name="name"
          placeholder="Organization name"
          required
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
          <label htmlFor="recoverySecret" className="text-xs font-medium text-slate-700">
            Owner-removal secret
          </label>
          <p className="mt-1 text-xs text-slate-500">
            Required to remove or demote this organization&apos;s last or second-to-last owner —
            protects against a lockout. Store it somewhere safe; it can&apos;t be recovered or
            changed later.
          </p>
          <input
            id="recoverySecret"
            name="recoverySecret"
            type="password"
            placeholder="At least 8 characters"
            required
            minLength={8}
            className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            name="recoverySecretConfirm"
            type="password"
            placeholder="Confirm secret"
            required
            minLength={8}
            className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {isPending ? "Creating…" : "Create organization"}
        </button>
        {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      </form>
    </div>
  );
}
