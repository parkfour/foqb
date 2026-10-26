"use client";

import { useActionState, useState } from "react";

type VoidAction = (prev: { error: string | null }, formData: FormData) => Promise<{ error: string | null }>;

// Void, asked twice when there are payments to undo. No browser confirm():
// the second step is a button in the row.
export function VoidButton({ id, action, warning }: { id: string; action: VoidAction; warning?: string }) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  const [asking, setAsking] = useState(false);

  if (warning && !asking) {
    return (
      <button type="button" onClick={() => setAsking(true)} className="text-sm text-slate-400 hover:text-red-600">
        Void
      </button>
    );
  }

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name="id" value={id} />
      {asking && <span className="max-w-xs text-xs text-slate-600">{warning}</span>}
      <span className="flex gap-2">
        {asking && (
          <button type="button" onClick={() => setAsking(false)} className="text-sm text-slate-400 hover:text-slate-700">
            Keep
          </button>
        )}
        <button type="submit" disabled={pending} className="text-sm text-slate-400 hover:text-red-600 disabled:opacity-50">
          {pending ? "Voiding…" : asking ? "Void it" : "Void"}
        </button>
      </span>
      {state.error && <span className="max-w-xs text-xs text-red-600">{state.error}</span>}
    </form>
  );
}
