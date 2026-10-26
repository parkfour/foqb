"use client";

import { useActionState } from "react";
import { invoiceTime } from "@/app/(dashboard)/time/actions";

export function InvoiceTimeForm({ customerId, today }: { customerId: string; today: string }) {
  const [state, action, pending] = useActionState(invoiceTime, { error: null });
  return (
    <form action={action} className="flex flex-wrap items-center justify-end gap-2">
      <input type="hidden" name="customerId" value={customerId} />
      <input name="invoiceNumber" placeholder="Invoice number" required className="w-32 rounded-md border border-slate-300 px-2 py-1 text-sm" />
      <input type="date" name="invoiceDate" defaultValue={today} required className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
      <button type="submit" disabled={pending} className="text-sm font-medium text-slate-700 underline hover:text-slate-900 disabled:opacity-50">
        {pending ? "Invoicing…" : "Invoice"}
      </button>
      {state.error && <span className="w-full text-right text-xs text-red-600">{state.error}</span>}
    </form>
  );
}
