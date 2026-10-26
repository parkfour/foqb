"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { formatAccountLabel } from "@/lib/accounts/format";
import { useBookToday } from "@/components/providers/book-clock-provider";
import { TimezoneChangeNotice } from "@/components/ui/timezone-change-notice";
import { useMoney } from "@/components/providers/book-currency-provider";
import { applyTaxes, type SalesTaxRate } from "@/lib/sales-tax";
import { ClassSelect, type ClassOption } from "@/components/classes/class-select";

interface CustomerOption {
  id: string;
  name: string;
}

interface AccountOption {
  id: string;
  account_number: string;
  name: string;
}

interface ItemOption {
  id: string;
  name: string;
  income_account_id: string;
  sale_price: number | null;
}

interface LineDraft {
  itemId: string;
  accountId: string;
  description: string;
  quantity: string;
  unitPrice: string;
}

// The same form makes an estimate: no due date but an expiry, and no
// journal entry until it's turned into an invoice.
const KINDS = {
  invoice: { title: "New Invoice", number: "Invoice number", second: "Due date", submit: "Create Invoice", endpoint: "/api/invoices", done: "/customers" },
  estimate: { title: "New Estimate", number: "Estimate number", second: "Expires on", submit: "Create Estimate", endpoint: "/api/estimates", done: "/customers/estimates" },
} as const;

function emptyLine(): LineDraft {
  return { itemId: "", accountId: "", description: "", quantity: "1", unitPrice: "" };
}

export function InvoiceForm({
  organizationId,
  customers,
  accounts,
  items,
  defaultTaxRate = 0,
  taxRates = [],
  showAccountCodes = true,
  kind = "invoice",
  classes = [],
}: {
  organizationId: string;
  customers: CustomerOption[];
  accounts: AccountOption[];
  items: ItemOption[];
  defaultTaxRate?: number;
  // The book's named rates; when there are any, the invoice picks from them.
  taxRates?: SalesTaxRate[];
  showAccountCodes?: boolean;
  kind?: keyof typeof KINDS;
  classes?: ClassOption[];
}) {
  const labels = KINDS[kind];
  const formatCurrency = useMoney();
  const router = useRouter();
  const [customerId, setCustomerId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const today = useBookToday();
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [dueDate, setDueDate] = useState("");
  const [taxRate, setTaxRate] = useState(String(defaultTaxRate || ""));
  const [taxRateIds, setTaxRateIds] = useState<string[]>([]);
  const [classId, setClassId] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function updateLine(index: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function selectItem(index: number, itemId: string) {
    const item = items.find((i) => i.id === itemId);
    if (!item) {
      updateLine(index, { itemId: "" });
      return;
    }
    updateLine(index, {
      itemId,
      description: item.name,
      accountId: item.income_account_id,
      unitPrice: item.sale_price != null ? String(item.sale_price) : "",
    });
  }

  function addLine() {
    setLines((prev) => [...prev, emptyLine()]);
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  const subtotal = lines.reduce(
    (sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0),
    0,
  );
  const named = applyTaxes(subtotal, taxRates.filter((r) => taxRateIds.includes(r.id)));
  const taxAmount =
    taxRates.length > 0 ? named.totalTax : Math.round(subtotal * ((Number(taxRate) || 0) / 100) * 100) / 100;
  const total = subtotal + taxAmount;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!customerId || !invoiceNumber) {
      setError(`Customer and ${labels.number.toLowerCase()} are required`);
      return;
    }

    const parsedLines = lines
      .filter((line) => line.accountId)
      .map((line) => ({
        item_id: line.itemId || null,
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
      const response = await fetch(labels.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organization_id: organizationId,
          customer_id: customerId,
          ...(kind === "invoice"
            ? { invoice_number: invoiceNumber, invoice_date: invoiceDate, due_date: dueDate || null }
            : { estimate_number: invoiceNumber, estimate_date: invoiceDate, expiry_date: dueDate || null }),
          ...(taxRates.length > 0 ? { tax_rate_ids: taxRateIds } : { tax_rate: Number(taxRate) || 0 }),
          lines: parsedLines,
          class_id: classId || null,
        }),
      });

      if (!response.ok) {
        const responseBody = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(responseBody.error ?? `Failed to save the ${kind}`);
      }

      router.push(labels.done);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : `Failed to save the ${kind}`);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-lg font-semibold text-slate-900">{labels.title}</h1>
      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
        <TimezoneChangeNotice from={invoiceDate} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <select
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            required
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Customer…</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </select>
          <input
            value={invoiceNumber}
            onChange={(e) => setInvoiceNumber(e.target.value)}
            placeholder={labels.number}
            required
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <input
              type="date"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
              required
              className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            placeholder={labels.second}
            aria-label={labels.second}
            title={labels.second}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <ClassSelect classes={classes} value={classId} onChange={setClassId} />
        </div>

        <div className="flex flex-col gap-2">
          {lines.map((line, index) => (
            <div key={index} className="flex flex-wrap items-center gap-2">
              <select
                value={line.itemId}
                onChange={(e) => selectItem(index, e.target.value)}
                className="min-w-[160px] rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">Item… (optional)</option>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
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
                <option value="">Revenue account…</option>
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
          <div className="flex flex-col items-end gap-1 text-sm">
            <p className="text-slate-600">Subtotal: {formatCurrency(subtotal)}</p>
            {taxRates.length > 0 ? (
              taxRates.map((r) => {
                const tax = named.taxes.find((t) => t.tax_rate_id === r.id);
                return (
                  <label key={r.id} className="flex items-center gap-2 text-slate-600">
                    <input
                      type="checkbox"
                      checked={taxRateIds.includes(r.id)}
                      onChange={(e) =>
                        setTaxRateIds((prev) => (e.target.checked ? [...prev, r.id] : prev.filter((id) => id !== r.id)))
                      }
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    {r.name} ({Number(r.rate)}%){tax ? `: ${formatCurrency(tax.amount)}` : ""}
                  </label>
                );
              })
            ) : (
              <label className="flex items-center gap-2 text-slate-600">
                Tax rate
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={taxRate}
                  onChange={(e) => setTaxRate(e.target.value)}
                  className="w-20 rounded-md border border-slate-300 px-2 py-1 text-sm"
                />
                %
              </label>
            )}
            <p className="text-slate-600">Tax: {formatCurrency(taxAmount)}</p>
            <p className="font-medium text-slate-900">Total: {formatCurrency(total)}</p>
          </div>
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {isSubmitting ? "Saving…" : labels.submit}
        </button>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>
    </div>
  );
}
