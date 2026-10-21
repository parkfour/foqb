"use client";

import { useState } from "react";
import { createRecurringBill } from "@/app/(dashboard)/vendors/recurring/actions";
import { formatAccountLabel } from "@/lib/accounts/format";
import { useBookToday } from "@/components/providers/book-clock-provider";
import { useMoney } from "@/components/providers/book-currency-provider";

interface VendorOption {
  id: string;
  name: string;
}

interface AccountOption {
  id: string;
  account_number: string;
  name: string;
}

interface LineDraft {
  accountId: string;
  description: string;
  quantity: string;
  unitPrice: string;
}

function emptyLine(): LineDraft {
  return { accountId: "", description: "", quantity: "1", unitPrice: "" };
}

export function RecurringBillForm({
  organizationId,
  vendors,
  accounts,
  showAccountCodes = true,
}: {
  organizationId: string;
  vendors: VendorOption[];
  accounts: AccountOption[];
  showAccountCodes?: boolean;
}) {
  const formatCurrency = useMoney();
  const [vendorId, setVendorId] = useState("");
  const [frequency, setFrequency] = useState<"weekly" | "monthly" | "yearly">("monthly");
  const today = useBookToday();
  const [nextDate, setNextDate] = useState(today);
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function updateLine(index: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function addLine() {
    setLines((prev) => [...prev, emptyLine()]);
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  const total = lines.reduce(
    (sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0),
    0,
  );

  async function handleSubmit() {
    setError(null);

    if (!vendorId || !nextDate) {
      setError("Vendor and next date are required");
      return;
    }

    const parsedLines = lines
      .filter((line) => line.accountId)
      .map((line) => ({
        accountId: line.accountId,
        description: line.description,
        quantity: Number(line.quantity || 0),
        unitPrice: Number(line.unitPrice || 0),
      }));

    if (parsedLines.length === 0) {
      setError("Add at least one line");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await createRecurringBill({
        organizationId,
        vendorId,
        frequency,
        nextDate,
        lines: parsedLines,
      });

      if (result?.error) {
        setError(result.error);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create recurring bill");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-lg font-semibold text-slate-900">New Recurring Bill</h1>
      <div className="mt-4 flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <select
            value={vendorId}
            onChange={(e) => setVendorId(e.target.value)}
            required
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Vendor…</option>
            {vendors.map((vendor) => (
              <option key={vendor.id} value={vendor.id}>
                {vendor.name}
              </option>
            ))}
          </select>
          <select
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as typeof frequency)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
          <input
            type="date"
            value={nextDate}
            onChange={(e) => setNextDate(e.target.value)}
            required
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="flex flex-col gap-2">
          {lines.map((line, index) => (
            <div key={index} className="flex flex-wrap items-center gap-2">
              <input
                value={line.description}
                onChange={(e) => updateLine(index, { description: e.target.value })}
                placeholder="Description"
                className="min-w-[160px] flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <select
                value={line.accountId}
                onChange={(e) => updateLine(index, { accountId: e.target.value })}
                className="min-w-[200px] rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">Expense account…</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {formatAccountLabel(account, showAccountCodes)}
                  </option>
                ))}
              </select>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="Qty"
                value={line.quantity}
                onChange={(e) => updateLine(index, { quantity: e.target.value })}
                className="w-20 rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="Unit price"
                value={line.unitPrice}
                onChange={(e) => updateLine(index, { unitPrice: e.target.value })}
                className="w-28 rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              {lines.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeLine(index)}
                  className="text-sm text-slate-400 hover:text-red-600"
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={addLine}
            className="text-sm font-medium text-slate-600 hover:text-slate-900"
          >
            + Add line
          </button>
          <p className="text-sm font-medium text-slate-900">Total: {formatCurrency(total)}</p>
        </div>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={isSubmitting}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {isSubmitting ? "Saving…" : "Create Recurring Bill"}
        </button>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}
