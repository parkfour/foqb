"use client";

import { useState, useTransition } from "react";
import { addSalesTaxRate, lookupSalesTaxRates, type LookedUpRate } from "@/app/(dashboard)/settings/sales-tax-actions";

const input = "rounded-md border border-slate-300 px-3 py-2 text-sm";

// Shown when one of the book's plugins can look rates up by address.
export function SalesTaxLookup({ organizationId, sources }: { organizationId: string; sources: string[] }) {
  const [result, setResult] = useState<{ rates?: LookedUpRate[]; error?: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="mt-4 border-t border-slate-100 pt-3">
      <p className="text-xs text-slate-500">Look up the rates for an address ({sources.join(", ")}), then add the ones you collect.</p>
      <form
        className="mt-2 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const get = (k: string) => String(f.get(k) ?? "");
          startTransition(async () =>
            setResult(
              await lookupSalesTaxRates(organizationId, {
                street: get("street"),
                city: get("city"),
                state: get("state"),
                zip: get("zip"),
                country: get("country"),
              }),
            ),
          );
        }}
      >
        <input name="street" placeholder="Street (optional)" aria-label="Street" className={input} />
        <input name="city" placeholder="City" aria-label="City" className={input} />
        <input name="state" placeholder="State" aria-label="State" className={`${input} w-20`} />
        <input name="zip" placeholder="ZIP" aria-label="ZIP" required className={`${input} w-28`} />
        <input name="country" defaultValue="US" aria-label="Country" required className={`${input} w-16`} />
        <button type="submit" disabled={isPending} className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50">
          {isPending ? "Looking up…" : "Look up rates"}
        </button>
      </form>
      {result?.error && <p className="mt-2 text-xs text-red-700">{result.error}</p>}
      {result?.rates && (
        <ul className="mt-2 flex flex-col gap-1 text-sm">
          {result.rates.length === 0 && <li className="text-xs text-slate-500">No rates found for that address.</li>}
          {result.rates.map((r) => (
            <li key={`${r.source}${r.name}`} className="flex items-center gap-3">
              <span>
                {r.name}: {r.rate}% <span className="text-xs text-slate-400">({r.source})</span>
              </span>
              <form action={addSalesTaxRate}>
                <input type="hidden" name="organizationId" value={organizationId} />
                <input type="hidden" name="name" value={r.name} />
                <input type="hidden" name="rate" value={r.rate} />
                <button type="submit" className="text-xs text-slate-600 underline hover:text-slate-900">
                  Add
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
