"use client";

import { useActionState } from "react";
import { createInventoryItem } from "@/app/(dashboard)/inventory/actions";
import type { ActionState } from "@/app/(dashboard)/actions";
import { formatAccountLabel } from "@/lib/accounts/format";

interface AccountOption {
  id: string;
  account_number: string;
  name: string;
}

const initialState: ActionState = { error: null };

export function NewItemForm({
  organizationId,
  accounts,
  showAccountCodes = true,
}: {
  organizationId: string;
  accounts: AccountOption[];
  showAccountCodes?: boolean;
}) {
  const [state, formAction, isPending] = useActionState(createInventoryItem, initialState);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-slate-900">New Item</h2>
      <form action={formAction} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <input type="hidden" name="organizationId" value={organizationId} />

        <input
          name="sku"
          placeholder="SKU"
          required
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />

        <input
          name="name"
          placeholder="Item name"
          required
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />

        <input
          name="quantityOnHand"
          type="number"
          step="0.01"
          min="0"
          placeholder="Quantity on hand"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />

        <input
          name="unitCost"
          type="number"
          step="0.01"
          min="0"
          placeholder="Unit cost"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />

        <select
          name="assetAccountId"
          defaultValue=""
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">Asset account (optional)</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {formatAccountLabel(account, showAccountCodes)}
            </option>
          ))}
        </select>

        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 sm:col-span-2 lg:col-span-1"
        >
          {isPending ? "Adding…" : "Add Item"}
        </button>
      </form>
      {state.error && <p className="mt-2 text-sm text-red-600">{state.error}</p>}
    </div>
  );
}
