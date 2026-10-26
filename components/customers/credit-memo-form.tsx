"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { formatAccountLabel } from "@/lib/accounts/format";
import { useBookToday } from "@/components/providers/book-clock-provider";
import { useMoney } from "@/components/providers/book-currency-provider";
import { createCreditMemo } from "@/app/(dashboard)/customers/credit-memos/actions";
import type { OpenInvoice } from "@/lib/ar/open-invoices";

interface AccountOption {
  id: string;
  account_number: string;
  name: string;
  type: string;
}

interface LineDraft {
  accountId: string;
  description: string;
  amount: string;
}

const emptyLine = (): LineDraft => ({ accountId: "", description: "", amount: "" });

export function CreditMemoForm({
  customers,
  accounts,
  invoices,
  showAccountCodes,
}: {
  customers: { id: string; name: string }[];
  // Revenue accounts, and liabilities for giving back sales tax.
  accounts: AccountOption[];
  invoices: OpenInvoice[];
  showAccountCodes: boolean;
}) {
  const formatCurrency = useMoney();
  const router = useRouter();
  const today = useBookToday();
  const [customerId, setCustomerId] = useState("");
  const [memoNumber, setMemoNumber] = useState("");
  const [memoDate, setMemoDate] = useState(today);
  const [reason, setReason] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const total = lines.reduce((sum, l) => sum + (Number(l.amount) || 0), 0);
  const customerInvoices = invoices.filter((i) => i.customer_id === customerId);
  const updateLine = (index: number, patch: Partial<LineDraft>) =>
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const parsed = lines
      .filter((l) => l.accountId)
      .map((l) => ({ accountId: l.accountId, description: l.description, amount: Number(l.amount) || 0 }));
    if (parsed.length === 0) {
      setError("Add at least one line");
      return;
    }
    startTransition(async () => {
      const result = await createCreditMemo({ customerId, memoNumber, memoDate, reason, invoiceId: invoiceId || null, lines: parsed });
      if (result.error) setError(result.error);
      else router.push("/customers/credit-memos");
    });
  }

  const input = "rounded-md border border-slate-300 px-3 py-2 text-sm";

  return (
    <div className="mx-auto max-w-3xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-lg font-semibold text-slate-900">New Credit Memo</h1>
      <p className="mt-1 text-sm text-slate-500">
        Money given back to a customer. Each line comes off its account (sales, or sales tax given back), and the
        customer owes the total less.
      </p>
      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <select
            value={customerId}
            onChange={(e) => {
              setCustomerId(e.target.value);
              setInvoiceId("");
            }}
            required
            className={input}
          >
            <option value="">Customer…</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input value={memoNumber} onChange={(e) => setMemoNumber(e.target.value)} placeholder="Memo number" required className={input} />
          <input type="date" value={memoDate} onChange={(e) => setMemoDate(e.target.value)} required className={input} />
        </div>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" className={input} />

        <div className="flex flex-col gap-2">
          {lines.map((line, index) => (
            <div key={index} className="flex flex-wrap items-center gap-2">
              <select
                value={line.accountId}
                onChange={(e) => updateLine(index, { accountId: e.target.value })}
                className={`min-w-[200px] ${input}`}
              >
                <option value="">Account…</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {formatAccountLabel(a, showAccountCodes)}
                  </option>
                ))}
              </select>
              <input
                value={line.description}
                onChange={(e) => updateLine(index, { description: e.target.value })}
                placeholder="Description"
                className={`min-w-[160px] flex-1 ${input}`}
              />
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="Amount"
                value={line.amount}
                onChange={(e) => updateLine(index, { amount: e.target.value })}
                className={`w-28 ${input}`}
              />
              {lines.length > 1 && (
                <button
                  type="button"
                  onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}
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
            onClick={() => setLines((prev) => [...prev, emptyLine()])}
            className="text-sm font-medium text-slate-600 hover:text-slate-900"
          >
            + Add line
          </button>
          <p className="text-sm font-medium text-slate-900">Total credit: {formatCurrency(total)}</p>
        </div>

        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Apply to an invoice
          <select value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} disabled={!customerId} className={input}>
            <option value="">Not yet: keep it as credit for the customer</option>
            {customerInvoices.map((i) => (
              <option key={i.id} value={i.id} disabled={i.remaining < total}>
                {i.invoice_number} ({formatCurrency(i.remaining)} owed)
              </option>
            ))}
          </select>
        </label>

        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Create Credit Memo"}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>
    </div>
  );
}
