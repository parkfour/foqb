"use client";

import { useActionState, useState } from "react";
import { addTrip } from "@/app/(dashboard)/mileage/actions";
import { standardMileageRate } from "@/lib/mileage/rates";
import { useBookToday } from "@/components/providers/book-clock-provider";

export function TripForm() {
  const today = useBookToday();
  const [date, setDate] = useState(today);
  const [rate, setRate] = useState(String(standardMileageRate(today)));
  const [state, action, pending] = useActionState(addTrip, { error: null });
  const input = "rounded-md border border-slate-300 px-3 py-2 text-sm";

  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <input
          type="date"
          name="tripDate"
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            setRate(String(standardMileageRate(e.target.value)));
          }}
          required
          className={input}
        />
        <input type="number" name="miles" step="0.1" min="0.1" placeholder="Miles" required className={input} />
        <label className="flex items-center gap-2 text-sm text-slate-600">
          $
          <input
            type="number"
            name="rate"
            step="0.0001"
            min="0"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            required
            className={`w-24 ${input}`}
            aria-label="Rate per mile"
          />
          / mile
        </label>
        <input name="vehicle" placeholder="Vehicle (optional)" className={input} />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <input name="purpose" placeholder="Business purpose" required className={input} />
        <input name="startPlace" placeholder="From (optional)" className={input} />
        <input name="endPlace" placeholder="To (optional)" className={input} />
      </div>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Log trip"}
        </button>
        <span className="text-xs text-slate-500">The rate starts at the IRS standard rate for the date.</span>
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
      </div>
    </form>
  );
}
