"use client";

import { useActionState } from "react";
import { addClass } from "@/app/(dashboard)/classes/actions";

export function AddClassForm() {
  const [state, action, pending] = useActionState(addClass, { error: null });
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input name="name" placeholder="Class name (a department, a location…)" required className="min-w-[260px] rounded-md border border-slate-300 px-3 py-2 text-sm" />
      <button type="submit" disabled={pending} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
        Add class
      </button>
      {state.error && <span className="text-sm text-red-600">{state.error}</span>}
    </form>
  );
}
