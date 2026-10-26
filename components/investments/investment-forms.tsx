"use client";

import { useActionState, useState } from "react";
import { addTrade, setPrice, updatePrices } from "@/app/(dashboard)/investments/actions";
import { formatAccountLabel } from "@/lib/accounts/format";
import { useBookToday } from "@/components/providers/book-clock-provider";

interface AccountOption {
  id: string;
  account_number: string;
  name: string;
}

const input = "rounded-md border border-slate-300 px-3 py-2 text-sm";

export function TradeForm({
  investmentAccounts,
  cashAccounts,
  gainAccounts,
  showAccountCodes,
}: {
  investmentAccounts: AccountOption[];
  cashAccounts: AccountOption[];
  gainAccounts: AccountOption[];
  showAccountCodes: boolean;
}) {
  const today = useBookToday();
  const [kind, setKind] = useState("buy");
  const [state, action, pending] = useActionState(addTrade, { error: null });
  const label = (a: AccountOption) => formatAccountLabel(a, showAccountCodes);

  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <select name="accountId" required defaultValue="" className={input}>
          <option value="" disabled>
            Brokerage or retirement account…
          </option>
          {investmentAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {label(a)}
            </option>
          ))}
        </select>
        <select name="kind" value={kind} onChange={(e) => setKind(e.target.value)} className={input}>
          <option value="buy">Bought</option>
          <option value="sell">Sold</option>
        </select>
        <input name="symbol" placeholder="Symbol (VTI)" required className={`${input} uppercase`} />
        <input type="date" name="tradeDate" defaultValue={today} required className={input} />
        <input type="number" name="quantity" step="any" min="0" placeholder="Shares" required className={input} />
        <input type="number" name="price" step="any" min="0" placeholder="Price per share" required className={input} />
        <input type="number" name="fees" step="0.01" min="0" placeholder="Fees" className={input} />
        <input name="name" placeholder="Name (optional)" className={input} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <select name="cashAccountId" defaultValue="" className={input}>
          <option value="">Don&apos;t book it (the feed already did)</option>
          {cashAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              Book it: cash {kind === "buy" ? "from" : "to"} {label(a)}
            </option>
          ))}
        </select>
        {kind === "sell" && (
          <select name="gainAccountId" defaultValue="" className={input}>
            <option value="">Gain or loss account…</option>
            {gainAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {label(a)}
              </option>
            ))}
          </select>
        )}
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Record trade"}
        </button>
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
      </div>
    </form>
  );
}

export function PriceForm() {
  const today = useBookToday();
  const [state, action, pending] = useActionState(setPrice, { error: null });
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input name="symbol" placeholder="Symbol" required className={`w-28 ${input} uppercase`} />
      <input type="date" name="priceDate" defaultValue={today} required className={input} />
      <input type="number" name="price" step="any" min="0" placeholder="Price" required className={`w-32 ${input}`} />
      <button type="submit" disabled={pending} className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50">
        Set price
      </button>
      {state.error && <span className="text-sm text-red-600">{state.error}</span>}
    </form>
  );
}

export function UpdatePricesButton() {
  const [state, action, pending] = useActionState(updatePrices, { error: null });
  return (
    <form action={action} className="flex items-center gap-2">
      <button type="submit" disabled={pending} className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50">
        {pending ? "Updating…" : "Update prices"}
      </button>
      {state.error && <span className="text-sm text-amber-700">{state.error}</span>}
    </form>
  );
}
