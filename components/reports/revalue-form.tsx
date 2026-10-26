"use client";

import { useActionState } from "react";
import { revalueAccount } from "@/app/(dashboard)/reports/fx/actions";
import { formatAccountLabel } from "@/lib/accounts/format";

export function RevalueForm({
  accountId,
  asOf,
  suggestedRate,
  gainLossAccounts,
  showAccountCodes,
}: {
  accountId: string;
  asOf: string;
  suggestedRate: number | null;
  gainLossAccounts: { id: string; account_number: string; name: string }[];
  showAccountCodes: boolean;
}) {
  const [state, action, pending] = useActionState(revalueAccount, { error: null });
  return (
    <form action={action} className="flex flex-wrap items-center justify-end gap-2">
      <input type="hidden" name="accountId" value={accountId} />
      <input type="hidden" name="asOf" value={asOf} />
      <input
        type="number"
        name="rate"
        step="any"
        min="0"
        required
        defaultValue={suggestedRate ?? ""}
        placeholder="Rate"
        aria-label="Rate"
        className="w-24 rounded-md border border-slate-300 px-2 py-1 text-sm"
      />
      <select name="gainLossAccountId" required defaultValue="" className="rounded-md border border-slate-300 px-2 py-1 text-sm">
        <option value="" disabled>
          Exchange gain/loss account…
        </option>
        {gainLossAccounts.map((a) => (
          <option key={a.id} value={a.id}>
            {formatAccountLabel(a, showAccountCodes)}
          </option>
        ))}
      </select>
      <button type="submit" disabled={pending} className="text-sm font-medium text-slate-700 underline hover:text-slate-900 disabled:opacity-50">
        {pending ? "Booking…" : "Revalue"}
      </button>
      {state.error && <span className="w-full text-right text-xs text-red-600">{state.error}</span>}
    </form>
  );
}
