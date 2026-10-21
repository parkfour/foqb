"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { formatAccountLabel } from "@/lib/accounts/format";
import { useBookToday } from "@/components/providers/book-clock-provider";
import { TimezoneChangeNotice } from "@/components/ui/timezone-change-notice";
import { PluginSlot } from "@/components/plugins/plugin-slot";
import type { BillPrefill } from "@/lib/plugins/types";

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

export function BillForm({
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
  const router = useRouter();
  const [vendorId, setVendorId] = useState("");
  const [billNumber, setBillNumber] = useState("");
  const today = useBookToday();
  const [billDate, setBillDate] = useState(today);
  const [dueDate, setDueDate] = useState("");
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

  // For a plugin in the bill.header slot (e.g. a receipt scanner): fills in
  // whatever it was given and leaves the rest.
  function prefill(bill: BillPrefill) {
    if (bill.vendorId) setVendorId(bill.vendorId);
    if (bill.billNumber) setBillNumber(bill.billNumber);
    if (bill.billDate) setBillDate(bill.billDate);
    if (bill.lines?.length) {
      setLines(
        bill.lines.map((line) => ({
          accountId: line.accountId ?? "",
          description: line.description,
          quantity: String(line.quantity),
          unitPrice: String(line.unitPrice),
        })),
      );
    }
  }

  const total = lines.reduce(
    (sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0),
    0,
  );

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!vendorId || !billNumber) {
      setError("Vendor and bill number are required");
      return;
    }

    const parsedLines = lines
      .filter((line) => line.accountId)
      .map((line) => ({
        account_id: line.accountId,
        description: line.description,
        quantity: Number(line.quantity || 0),
        unit_price: Number(line.unitPrice || 0),
      }));

    if (parsedLines.length === 0) {
      setError("Add at least one line");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/bills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organization_id: organizationId,
          vendor_id: vendorId,
          bill_number: billNumber,
          bill_date: billDate,
          due_date: dueDate || null,
          lines: parsedLines,
        }),
      });

      if (!response.ok) {
        const responseBody = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(responseBody.error ?? "Failed to enter bill");
      }

      router.push("/vendors");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to enter bill");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-lg font-semibold text-slate-900">Enter Bill</h1>
      <PluginSlot name="bill.header" context={{ vendors, accounts, prefill }} className="mt-3 flex items-center gap-2" />
      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
        <TimezoneChangeNotice from={billDate} />
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
          <input
            value={billNumber}
            onChange={(e) => setBillNumber(e.target.value)}
            placeholder="Bill number"
            required
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            type="date"
            value={billDate}
            onChange={(e) => setBillDate(e.target.value)}
            required
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            placeholder="Due date"
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
          <p className="text-sm font-medium text-slate-900">Total: ${total.toFixed(2)}</p>
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {isSubmitting ? "Saving…" : "Enter Bill"}
        </button>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>
    </div>
  );
}
