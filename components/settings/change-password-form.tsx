"use client";

import { useActionState } from "react";
import { changePassword, type ChangePasswordState } from "@/app/(dashboard)/settings/password-actions";

const initialState: ChangePasswordState = { error: null, done: false };
const input = "w-full max-w-xs rounded-md border border-slate-300 px-3 py-2 text-sm";

export function ChangePasswordForm() {
  const [state, formAction, isPending] = useActionState(changePassword, initialState);

  return (
    <div id="password" className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-slate-900">Your Password</h2>
      <form action={formAction} className="flex flex-col gap-2">
        <input
          type="password"
          name="currentPassword"
          aria-label="Current password"
          placeholder="Current password"
          autoComplete="current-password"
          required
          className={input}
        />
        <input
          type="password"
          name="password"
          aria-label="New password"
          placeholder="New password"
          autoComplete="new-password"
          required
          minLength={8}
          className={input}
        />
        <input
          type="password"
          name="confirmPassword"
          aria-label="Confirm new password"
          placeholder="Confirm new password"
          autoComplete="new-password"
          required
          minLength={8}
          className={input}
        />
        <button
          type="submit"
          disabled={isPending}
          className="w-fit rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {isPending ? "Changing…" : "Change password"}
        </button>
        {state.error && <p className="text-sm text-red-600">{state.error}</p>}
        {state.done && <p className="text-sm text-emerald-700">Password changed.</p>}
      </form>
    </div>
  );
}
