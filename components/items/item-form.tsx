"use client";

import { useActionState, useState } from "react";
import { createItem, updateItem } from "@/app/(dashboard)/items/actions";
import type { ActionState } from "@/app/(dashboard)/actions";
import { formatAccountLabel } from "@/lib/accounts/format";

interface AccountOption {
  id: string;
  account_number: string;
  name: string;
}

interface ItemFormProps {
  organizationId: string;
  accounts: AccountOption[];
  // For an item that's stock: inventory (asset) and cost of goods sold
  // (expense) accounts to choose from.
  assetAccounts?: AccountOption[];
  expenseAccounts?: AccountOption[];
  showAccountCodes?: boolean;
  item?: {
    id: string;
    name: string;
    description: string | null;
    income_account_id: string;
    sale_price: number | null;
    track_quantity: boolean;
    quantity_on_hand: number;
    // The count with every sale and purchase since (item_stock).
    on_hand?: number;
    inventory_account_id?: string | null;
    cogs_account_id?: string | null;
    unit_cost?: number;
  };
}

const initialState: ActionState = { error: null };

export function ItemForm({
  organizationId,
  accounts,
  assetAccounts = [],
  expenseAccounts = [],
  showAccountCodes = true,
  item,
}: ItemFormProps) {
  const isEdit = Boolean(item);
  const [state, formAction, isPending] = useActionState(
    isEdit ? updateItem : createItem,
    initialState,
  );
  const [trackQuantity, setTrackQuantity] = useState(item?.track_quantity ?? false);

  return (
    <div className="mx-auto max-w-lg rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-lg font-semibold text-slate-900">{isEdit ? "Edit Item" : "Add Item"}</h1>
      <form action={formAction} className="mt-4 flex flex-col gap-3">
        <input type="hidden" name="organizationId" value={organizationId} />
        {isEdit && <input type="hidden" name="id" value={item!.id} />}
        <input type="hidden" name="trackQuantity" value={trackQuantity ? "true" : "false"} />

        <input
          name="name"
          placeholder="Item name"
          required
          defaultValue={item?.name ?? ""}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <textarea
          name="description"
          placeholder="Description (optional)"
          defaultValue={item?.description ?? ""}
          rows={2}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />

        <select
          name="incomeAccountId"
          required
          defaultValue={item?.income_account_id ?? ""}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="" disabled>
            Income account…
          </option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {formatAccountLabel(account, showAccountCodes)}
            </option>
          ))}
        </select>

        <input
          name="salePrice"
          type="number"
          step="0.01"
          min="0"
          placeholder="Default sale price (optional)"
          defaultValue={item?.sale_price ?? ""}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={trackQuantity}
            onChange={(e) => setTrackQuantity(e.target.checked)}
          />
          Track quantity on hand
        </label>

        {trackQuantity && (
          <>
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              Quantity on hand (a count you enter here replaces what the books worked out)
              <input
                name="quantityOnHand"
                type="number"
                step="0.01"
                placeholder="Quantity on hand"
                defaultValue={item?.on_hand ?? item?.quantity_on_hand ?? ""}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <p className="text-xs text-slate-500">
              To book cost of goods sold, choose both accounts below. Bills that buy this item then add to the count
              at their price, and invoices that sell it move its average cost from inventory to cost of goods sold.
              An opening count isn&apos;t booked: enter its value in the inventory account yourself.
            </p>
            <select
              name="inventoryAccountId"
              defaultValue={item?.inventory_account_id ?? ""}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Inventory account (asset)…</option>
              {assetAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {formatAccountLabel(account, showAccountCodes)}
                </option>
              ))}
            </select>
            <select
              name="cogsAccountId"
              defaultValue={item?.cogs_account_id ?? ""}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Cost of goods sold account (expense)…</option>
              {expenseAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {formatAccountLabel(account, showAccountCodes)}
                </option>
              ))}
            </select>
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              Average cost per unit
              <input
                name="unitCost"
                type="number"
                step="0.0001"
                min="0"
                defaultValue={item?.unit_cost ?? ""}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
          </>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {isPending ? "Saving…" : isEdit ? "Save Changes" : "Add Item"}
        </button>
      </form>
      {state.error && <p className="mt-2 text-sm text-red-600">{state.error}</p>}
    </div>
  );
}
