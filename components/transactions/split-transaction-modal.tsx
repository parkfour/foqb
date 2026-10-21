"use client";

import { useId, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import {
  validateSplitTransaction,
  type SplitLineInput,
} from "@/lib/transactions/split";

export interface SplitTransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  transaction: {
    id: string;
    date: string;
    name: string | null;
    amount: number;
    account_id?: string | null;
  } | null;
  accounts: {
    id: string;
    account_number?: string;
    name: string;
    type?: string;
  }[];
  onSave?: (splits: SplitLineInput[]) => Promise<void> | void;
}

interface ModalLine {
  id: string;
  account_id: string;
  amount: string;
  memo: string;
}

function formatCurrency(val: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val);
}

export function SplitTransactionModal({
  isOpen,
  onClose,
  transaction,
  accounts,
  onSave,
}: SplitTransactionModalProps) {
  const baseId = useId();
  const [lines, setLines] = useState<ModalLine[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [prevKey, setPrevKey] = useState<string | null>(null);
  const currentKey = isOpen && transaction ? transaction.id : null;

  if (currentKey !== prevKey) {
    setPrevKey(currentKey);
    if (transaction && isOpen) {
      const absAmount = Math.abs(transaction.amount);
      setLines([
        {
          id: `${baseId}-1`,
          account_id: "",
          amount: absAmount.toFixed(2),
          memo: transaction.name || "",
        },
      ]);
      setError(null);
    }
  }

  if (!isOpen || !transaction) return null;

  const parentAmount = Number(transaction.amount);
  const expectedTotal = Math.round(Math.abs(parentAmount) * 100) / 100;

  const currentSplits: SplitLineInput[] = lines.map((l) => ({
    account_id: l.account_id,
    amount: parseFloat(l.amount) || 0,
    memo: l.memo,
  }));

  const validation = validateSplitTransaction(parentAmount, currentSplits);
  const isBalanced = validation.isValid;

  function addLine() {
    const remaining = Math.max(0, validation.difference);
    setLines((prev) => [
      ...prev,
      {
        id: `${baseId}-${Date.now()}-${prev.length}`,
        account_id: "",
        amount: remaining > 0 ? remaining.toFixed(2) : "0.00",
        memo: "",
      },
    ]);
  }

  function removeLine(index: number) {
    if (lines.length <= 1) return;
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  function updateLine(index: number, field: keyof ModalLine, val: string) {
    setLines((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: val };
      return copy;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isBalanced || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    try {
      if (onSave) {
        await onSave(currentSplits);
      }
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save split transaction");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="split-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 id="split-modal-title" className="text-base font-semibold text-slate-900">
              Split Transaction
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {transaction.date} &bull; {transaction.name || "Untitled transaction"} &bull;{" "}
              <span className="font-medium text-slate-700">
                {formatCurrency(expectedTotal)} {parentAmount < 0 ? "(Outflow)" : "(Inflow)"}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-6">
          <div className="max-h-72 overflow-y-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
                <tr>
                  <th className="py-2 pl-2 pr-3">Category / Account</th>
                  <th className="px-3 py-2">Memo / Description</th>
                  <th className="px-3 py-2 text-right">Amount ($)</th>
                  <th className="py-2 pl-2 pr-2 text-center w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lines.map((line, idx) => (
                  <tr key={line.id}>
                    <td className="py-2 pl-2 pr-3">
                      <select
                        aria-label={`Category for line ${idx + 1}`}
                        required
                        value={line.account_id}
                        onChange={(e) => updateLine(idx, "account_id", e.target.value)}
                        className="w-full rounded-md border border-slate-300 py-1.5 pl-2 pr-6 text-xs text-slate-800 focus:border-slate-500 focus:outline-none"
                      >
                        <option value="">Select category…</option>
                        {accounts.map((acc) => (
                          <option key={acc.id} value={acc.id}>
                            {acc.account_number ? `${acc.account_number} — ` : ""}
                            {acc.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        placeholder="Memo (optional)"
                        value={line.memo}
                        onChange={(e) => updateLine(idx, "memo", e.target.value)}
                        className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs text-slate-800 focus:border-slate-500 focus:outline-none"
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        required
                        aria-label={`Amount for line ${idx + 1}`}
                        value={line.amount}
                        onChange={(e) => updateLine(idx, "amount", e.target.value)}
                        className="w-28 rounded-md border border-slate-300 px-2 py-1.5 text-right font-mono text-xs text-slate-800 focus:border-slate-500 focus:outline-none"
                      />
                    </td>
                    <td className="py-2 pl-2 pr-2 text-center">
                      {lines.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeLine(idx)}
                          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-rose-600"
                          aria-label={`Delete line ${idx + 1}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between border-t border-slate-100 pt-3">
            <button
              type="button"
              onClick={addLine}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Split Line
            </button>

            <div className="flex items-center gap-4 text-xs font-medium">
              <div>
                <span className="text-slate-500">Split Total: </span>
                <span className="font-mono text-slate-800">
                  {formatCurrency(validation.totalSplits)}
                </span>
              </div>
              <div
                className={
                  Math.abs(validation.difference) < 0.005
                    ? "text-emerald-600 font-semibold"
                    : "text-amber-600 font-semibold"
                }
              >
                {Math.abs(validation.difference) < 0.005 ? (
                  "Balanced"
                ) : (
                  <>Remaining: {formatCurrency(validation.difference)}</>
                )}
              </div>
            </div>
          </div>

          {error && <p className="text-xs text-rose-600">{error}</p>}

          <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-md border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!isBalanced || isSubmitting}
              className="rounded-md bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {isSubmitting ? "Saving…" : "Save Split"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
