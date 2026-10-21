"use client";

import { useState } from "react";
import { createFixedAsset } from "@/app/(dashboard)/fixed-assets/actions";
import { formatAccountLabel } from "@/lib/accounts/format";
import { useBookToday } from "@/components/providers/book-clock-provider";

interface AccountOption {
  id: string;
  account_number: string;
  name: string;
}

export function FixedAssetForm({
  organizationId,
  assetAccounts,
  expenseAccounts,
  showAccountCodes = true,
}: {
  organizationId: string;
  assetAccounts: AccountOption[];
  expenseAccounts: AccountOption[];
  showAccountCodes?: boolean;
}) {
  const [name, setName] = useState("");
  const [assetAccountId, setAssetAccountId] = useState("");
  const [accumulatedDepreciationAccountId, setAccumulatedDepreciationAccountId] = useState("");
  const [depreciationExpenseAccountId, setDepreciationExpenseAccountId] = useState("");
  const today = useBookToday();
  const [purchaseDate, setPurchaseDate] = useState(today);
  const [cost, setCost] = useState("");
  const [salvageValue, setSalvageValue] = useState("0");
  const [usefulLifeMonths, setUsefulLifeMonths] = useState("60");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const monthly =
    Number(usefulLifeMonths) > 0
      ? ((Number(cost) || 0) - (Number(salvageValue) || 0)) / Number(usefulLifeMonths)
      : 0;

  async function handleSubmit() {
    setError(null);

    if (
      !name ||
      !assetAccountId ||
      !accumulatedDepreciationAccountId ||
      !depreciationExpenseAccountId ||
      !purchaseDate ||
      !cost ||
      !usefulLifeMonths
    ) {
      setError("All fields are required");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await createFixedAsset({
        organizationId,
        name,
        assetAccountId,
        accumulatedDepreciationAccountId,
        depreciationExpenseAccountId,
        purchaseDate,
        cost: Number(cost),
        salvageValue: Number(salvageValue) || 0,
        usefulLifeMonths: Number(usefulLifeMonths),
      });

      if (result?.error) {
        setError(result.error);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create fixed asset");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-lg font-semibold text-slate-900">New Fixed Asset</h1>
      <div className="mt-4 flex flex-col gap-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Asset name (e.g. Office Laptop)"
          required
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Asset account</label>
            <select
              value={assetAccountId}
              onChange={(e) => setAssetAccountId(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Select…</option>
              {assetAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {formatAccountLabel(account, showAccountCodes)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">
              Accumulated depreciation account
            </label>
            <select
              value={accumulatedDepreciationAccountId}
              onChange={(e) => setAccumulatedDepreciationAccountId(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Select…</option>
              {assetAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {formatAccountLabel(account, showAccountCodes)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Depreciation expense account</label>
            <select
              value={depreciationExpenseAccountId}
              onChange={(e) => setDepreciationExpenseAccountId(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Select…</option>
              {expenseAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {formatAccountLabel(account, showAccountCodes)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Purchase date</label>
            <input
              type="date"
              value={purchaseDate}
              onChange={(e) => setPurchaseDate(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Cost</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Salvage value</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={salvageValue}
              onChange={(e) => setSalvageValue(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Useful life (months)</label>
            <input
              type="number"
              step="1"
              min="1"
              value={usefulLifeMonths}
              onChange={(e) => setUsefulLifeMonths(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <p className="text-sm text-slate-600">
          Monthly depreciation: <span className="font-medium text-slate-900">${monthly.toFixed(2)}</span>
        </p>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={isSubmitting}
          className="w-fit rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {isSubmitting ? "Saving…" : "Create Fixed Asset"}
        </button>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}
