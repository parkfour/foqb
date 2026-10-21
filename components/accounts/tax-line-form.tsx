"use client";

import { startTransition, useActionState, useState } from "react";
import { updateAccountTaxLine } from "@/app/(dashboard)/accounts/actions";
import type { ActionState } from "@/app/(dashboard)/actions";
import { PER_PROPERTY_FORM } from "@/lib/tax/forms";

const initialState: ActionState = { error: null };

// One account's tax line, and its property when the line is kept per rental.
// Submitted by hand rather than through the form's action prop: React
// resets a form after its action, putting the selects back to what the page
// first rendered, so a saved line showed as the old one until a reload. The
// page keys this on the saved values, so a save remounts it with them.
export function TaxLineForm({
  account,
  taxLines,
  properties,
}: {
  account: { id: string; name: string; tax_line_id: string | null; property_id: string | null };
  taxLines: { id: string; form: string; code: string; label: string }[];
  properties: { id: string; name: string }[];
}) {
  const [state, formAction, isPending] = useActionState(updateAccountTaxLine, initialState);
  const [taxLineId, setTaxLineId] = useState(account.tax_line_id ?? "");
  const [propertyId, setPropertyId] = useState(account.property_id ?? "");
  const perProperty = taxLines.find((t) => t.id === taxLineId)?.form === PER_PROPERTY_FORM;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => formAction(data));
      }}
      className="flex flex-wrap items-center gap-2"
    >
      <input type="hidden" name="id" value={account.id} />
      <select
        name="taxLineId"
        value={taxLineId}
        onChange={(e) => setTaxLineId(e.target.value)}
        aria-label={`Tax line for ${account.name}`}
        className="rounded-md border border-slate-300 px-2 py-1 text-xs"
      >
        <option value="">Unassigned</option>
        {taxLines.map((t) => (
          <option key={t.id} value={t.id}>
            {t.code} — {t.label}
          </option>
        ))}
      </select>
      {perProperty && (
        <select
          name="propertyId"
          value={propertyId}
          onChange={(e) => setPropertyId(e.target.value)}
          aria-label={`Property for ${account.name}`}
          className="rounded-md border border-slate-300 px-2 py-1 text-xs"
        >
          <option value="">No property</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      <button
        type="submit"
        disabled={isPending}
        className="text-xs text-slate-500 hover:text-slate-900 disabled:opacity-50"
      >
        {isPending ? "Saving…" : "Save"}
      </button>
      {state.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  );
}
