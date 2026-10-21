"use client";

import { useActionState } from "react";
import { createSiteAdminAccount } from "@/app/(site-admin)/site-admin/actions";
import type { MemberCredentialsState } from "@/app/(dashboard)/settings/actions";

const initialState: MemberCredentialsState = { error: null };

export function CreateSiteAdminForm() {
  const [state, formAction, isPending] = useActionState(createSiteAdminAccount, initialState);

  return (
    <div className="mt-4 flex flex-col gap-3">
      {state.credentials ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm">
          <p className="font-medium text-emerald-900">
            Account created — copy this password now, it won&apos;t be shown again.
          </p>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-emerald-900">
            <dt className="font-medium">Email</dt>
            <dd className="font-mono">{state.credentials.email}</dd>
            <dt className="font-medium">Password</dt>
            <dd className="font-mono">{state.credentials.password}</dd>
          </dl>
          <p className="mt-2 text-xs text-emerald-700">
            Distribute these yourself — there&rsquo;s no email step. The account expires
            automatically if it&rsquo;s never logged into.
          </p>
        </div>
      ) : (
        <form action={formAction} className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="newSiteAdminEmail" className="text-xs font-medium text-slate-700">
              New Site Admin&rsquo;s email
            </label>
            <input
              type="email"
              id="newSiteAdminEmail"
              name="email"
              placeholder="name@example.com"
              required
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={isPending}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {isPending ? "Creating…" : "Create Site Admin account"}
          </button>
        </form>
      )}
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
    </div>
  );
}
