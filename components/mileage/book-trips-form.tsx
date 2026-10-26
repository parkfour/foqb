"use client";

import { useActionState } from "react";
import { bookTrips } from "@/app/(dashboard)/mileage/actions";
import { formatAccountLabel } from "@/lib/accounts/format";

interface AccountOption {
  id: string;
  account_number: string;
  name: string;
}

export function BookTripsForm({
  year,
  expenseAccounts,
  creditAccounts,
  showAccountCodes,
}: {
  year: number;
  expenseAccounts: AccountOption[];
  creditAccounts: AccountOption[];
  showAccountCodes: boolean;
}) {
  const [state, action, pending] = useActionState(bookTrips, { error: null });
  const input = "rounded-md border border-slate-300 px-3 py-2 text-sm";

  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="year" value={year} />
      <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
        Expense
        <select name="expenseAccountId" required defaultValue="" className={input}>
          <option value="" disabled>
            Car and truck expenses…
          </option>
          {expenseAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {formatAccountLabel(a, showAccountCodes)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
        Owed to, or paid by
        <select name="creditAccountId" required defaultValue="" className={input}>
          <option value="" disabled>
            Owner&apos;s contribution, or a payable…
          </option>
          {creditAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {formatAccountLabel(a, showAccountCodes)}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {pending ? "Booking…" : "Book unbooked trips"}
      </button>
      {state.error && <p className="w-full text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
