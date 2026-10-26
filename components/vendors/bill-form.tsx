"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { formatAccountLabel } from "@/lib/accounts/format";
import { useBookToday } from "@/components/providers/book-clock-provider";
import { TimezoneChangeNotice } from "@/components/ui/timezone-change-notice";
import { PluginSlot } from "@/components/plugins/plugin-slot";
import type { BillPrefill } from "@/lib/plugins/types";
import { useMoney } from "@/components/providers/book-currency-provider";
import { uploadAttachment } from "@/components/attachments/attachments";
import { ClassSelect, type ClassOption } from "@/components/classes/class-select";

interface VendorOption {
  id: string;
  name: string;
}

interface AccountOption {
  id: string;
  account_number: string;
  name: string;
}

// An item that is stock (migration 086): a bill line for it goes to its
// inventory account and adds to its count.
interface StockItemOption {
  id: string;
  name: string;
  inventory_account_id: string;
}

interface LineDraft {
  itemId: string;
  accountId: string;
  description: string;
  quantity: string;
  unitPrice: string;
}

function emptyLine(): LineDraft {
  return { itemId: "", accountId: "", description: "", quantity: "1", unitPrice: "" };
}

export function BillForm({
  organizationId,
  vendors,
  accounts,
  showAccountCodes = true,
  stockItems = [],
  classes = [],
}: {
  organizationId: string;
  vendors: VendorOption[];
  accounts: AccountOption[];
  showAccountCodes?: boolean;
  stockItems?: StockItemOption[];
  classes?: ClassOption[];
}) {
  const formatCurrency = useMoney();
  const router = useRouter();
  const [vendorId, setVendorId] = useState("");
  const [billNumber, setBillNumber] = useState("");
  const today = useBookToday();
  const [billDate, setBillDate] = useState(today);
  const [dueDate, setDueDate] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [files, setFiles] = useState<File[]>([]);
  const [classId, setClassId] = useState("");
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
    const attachment = bill.attachment;
    if (attachment) setFiles((prev) => (prev.includes(attachment) ? prev : [...prev, attachment]));
    if (bill.lines?.length) {
      setLines(
        bill.lines.map((line) => ({
          itemId: "",
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
        ...(line.itemId ? { item_id: line.itemId } : {}),
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
          class_id: classId || null,
        }),
      });

      if (!response.ok) {
        const responseBody = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(responseBody.error ?? "Failed to enter bill");
      }

      const { journal_entry_id: entryId } = (await response.json()) as { journal_entry_id: string };
      try {
        for (const file of files) await uploadAttachment(entryId, file);
      } catch {
        // The bill is saved; its entry's page lets them attach it again.
        router.push(`/journal/${entryId}`);
        return;
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
          <ClassSelect classes={classes} value={classId} onChange={setClassId} />
        </div>

        <div className="flex flex-col gap-2">
          {lines.map((line, index) => (
            <div key={index} className="flex flex-wrap items-center gap-2">
              {stockItems.length > 0 && (
                <select
                  value={line.itemId}
                  onChange={(e) => {
                    const item = stockItems.find((i) => i.id === e.target.value);
                    updateLine(
                      index,
                      item
                        ? { itemId: item.id, accountId: item.inventory_account_id, description: line.description || item.name }
                        : { itemId: "" },
                    );
                  }}
                  className="min-w-[140px] rounded-md border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">Stock item… (optional)</option>
                  {stockItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              )}
              <input
                value={line.description}
                onChange={(e) => updateLine(index, { description: e.target.value })}
                placeholder="Description"
                className="min-w-[160px] flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <select
                value={line.accountId}
                onChange={(e) => updateLine(index, { accountId: e.target.value })}
                disabled={!!line.itemId}
                className="min-w-[200px] rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
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

        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="cursor-pointer font-medium text-slate-600 hover:text-slate-900">
            + Attach receipt
            <input
              type="file"
              multiple
              accept="application/pdf,image/*"
              onChange={(e) => {
                const picked = [...(e.target.files ?? [])];
                e.target.value = "";
                setFiles((prev) => [...prev, ...picked]);
              }}
              className="sr-only"
            />
          </label>
          {files.map((file, i) => (
            <span key={i} className="flex items-center gap-1 rounded bg-slate-100 px-2 py-1 text-xs text-slate-700">
              {file.name}
              <button
                type="button"
                aria-label={`Don't attach ${file.name}`}
                onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                className="text-slate-400 hover:text-red-600"
              >
                ×
              </button>
            </span>
          ))}
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
