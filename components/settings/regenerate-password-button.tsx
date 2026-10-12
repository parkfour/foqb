"use client";

import { useActionState } from "react";
import { regenerateMemberPassword } from "@/app/(dashboard)/settings/actions";
import type { MemberCredentialsState } from "@/app/(dashboard)/settings/actions";

const initialState: MemberCredentialsState = { error: null };

export function RegeneratePasswordButton({
  organizationId,
  userId,
  email,
}: {
  organizationId: string;
  userId: string;
  email: string;
}) {
  const [state, formAction, isPending] = useActionState(regenerateMemberPassword, initialState);

  if (state.credentials) {
    return (
      <p className="font-mono text-xs text-emerald-700">
        New password: {state.credentials.password}
      </p>
    );
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="email" value={email} />
      <button
        type="submit"
        disabled={isPending}
        className="text-xs text-slate-500 hover:text-slate-900 disabled:opacity-50"
      >
        {isPending ? "…" : "Regenerate password"}
      </button>
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
    </form>
  );
}
