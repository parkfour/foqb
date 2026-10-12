"use client";

import { useActionState } from "react";
import { demoteSiteAdmin } from "@/app/(site-admin)/site-admin/actions";
import type { ActionState } from "@/app/(dashboard)/actions";

const initialState: ActionState = { error: null };

export function DemoteSiteAdminButton({ userId }: { userId: string }) {
  const [state, formAction, isPending] = useActionState(demoteSiteAdmin, initialState);

  return (
    <div className="flex flex-col items-end gap-1">
      <form action={formAction}>
        <input type="hidden" name="userId" value={userId} />
        <button
          type="submit"
          disabled={isPending}
          className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50"
        >
          {isPending ? "…" : "Demote"}
        </button>
      </form>
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
    </div>
  );
}
