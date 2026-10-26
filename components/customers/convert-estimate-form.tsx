"use client";

import { useActionState } from "react";
import { convertEstimateToInvoice } from "@/app/(dashboard)/customers/estimates/actions";

export function ConvertEstimateForm({ id, defaultNumber, today }: { id: string; defaultNumber: string; today: string }) {
  const [state, action, pending] = useActionState(convertEstimateToInvoice, { error: null });

  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={id} />
      <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
        Invoice number
        <input name="invoiceNumber" defaultValue={defaultNumber} required className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
        Invoice date
        <input type="date" name="invoiceDate" defaultValue={today} required className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
        Due date
        <input type="date" name="dueDate" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {pending ? "Invoicing…" : "Turn into invoice"}
      </button>
      {state.error && <p className="w-full text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
