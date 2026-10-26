"use client";

import { useActionState } from "react";
import { addTimeEntry } from "@/app/(dashboard)/time/actions";
import { useBookToday } from "@/components/providers/book-clock-provider";

export function TimeEntryForm({
  customers,
  items,
}: {
  customers: { id: string; name: string }[];
  items: { id: string; name: string }[];
}) {
  const today = useBookToday();
  const [state, action, pending] = useActionState(addTimeEntry, { error: null });
  const input = "rounded-md border border-slate-300 px-3 py-2 text-sm";

  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <input type="date" name="workDate" defaultValue={today} required className={input} />
        <input type="number" name="hours" step="0.25" min="0.25" max="24" placeholder="Hours" required className={input} />
        <select name="customerId" defaultValue="" className={input}>
          <option value="">Customer (optional)</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select name="itemId" defaultValue="" className={input}>
          <option value="">Service item (optional)</option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <input name="description" placeholder="What you did" className={`min-w-[200px] flex-1 ${input}`} />
        <input type="number" name="rate" step="0.01" min="0" placeholder="Rate (else the item's price)" className={`w-56 ${input}`} />
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" name="billable" defaultChecked /> Billable
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Log time"}
        </button>
      </div>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
