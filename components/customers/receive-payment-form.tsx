"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { formatAccountLabel } from "@/lib/accounts/format";

interface CustomerOption {
  id: string;
  name: string;
}

interface InvoiceOption {
  id: string;
  invoiceNumber: string;
  customerId: string;
  remaining: number;
}

interface AccountOption {
  id: string;
  account_number: string;
  name: string;
}

interface BankTransactionOption {
  id: string;
  date: string;
  name: string | null;
  amount: number;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ReceivePaymentForm({
  customers,
  invoices,
  accounts,
  bankTransactions,
  showAccountCodes = true,
}: {
  customers: CustomerOption[];
  invoices: InvoiceOption[];
  accounts: AccountOption[];
  bankTransactions: BankTransactionOption[];
  showAccountCodes?: boolean;
}) {
  const router = useRouter();
  const [customerId, setCustomerId] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [bankTransactionId, setBankTransactionId] = useState("");
  const [amount, setAmount] = useState("");
  const [depositAccountId, setDepositAccountId] = useState("");
  const [paymentDate, setPaymentDate] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const customerInvoices = useMemo(
    () => invoices.filter((invoice) => invoice.customerId === customerId),
    [invoices, customerId],
  );
  const selectedInvoice = customerInvoices.find((invoice) => invoice.id === invoiceId);
  const matchedTransaction = bankTransactions.find((tx) => tx.id === bankTransactionId);

  function selectBankTransaction(id: string) {
    setBankTransactionId(id);
    const tx = bankTransactions.find((t) => t.id === id);
    setAmount(tx ? String(tx.amount) : "");
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!invoiceId || !amount || (!bankTransactionId && !depositAccountId)) {
      setError("Invoice, amount, and a deposit account or matched bank transaction are required");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/invoice-payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoice_id: invoiceId,
          payment_date: paymentDate,
          amount: Number(amount),
          deposit_account_id: depositAccountId || null,
          bank_transaction_id: bankTransactionId || null,
        }),
      });

      if (!response.ok) {
        const responseBody = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(responseBody.error ?? "Failed to record payment");
      }

      router.push("/customers");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to record payment");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-lg font-semibold text-slate-900">Receive Payment</h1>
      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
        <select
          value={customerId}
          onChange={(e) => {
            setCustomerId(e.target.value);
            setInvoiceId("");
          }}
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

        <select
          value={invoiceId}
          onChange={(e) => setInvoiceId(e.target.value)}
          required
          disabled={!customerId}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
        >
          <option value="">
            {customerId ? "Open invoice…" : "Select a customer first"}
          </option>
          {customerInvoices.map((invoice) => (
            <option key={invoice.id} value={invoice.id}>
              {invoice.invoiceNumber} — ${invoice.remaining.toFixed(2)} remaining
            </option>
          ))}
        </select>

        {selectedInvoice && (
          <p className="text-sm text-slate-500">
            Remaining balance: ${selectedInvoice.remaining.toFixed(2)}
          </p>
        )}

        {bankTransactions.length > 0 && (
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-slate-700">
              Match to a bank deposit (optional)
            </label>
            <select
              value={bankTransactionId}
              onChange={(e) => selectBankTransaction(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">None — enter manually</option>
              {bankTransactions.map((tx) => (
                <option key={tx.id} value={tx.id}>
                  {tx.date} — {tx.name ?? "Deposit"} — ${tx.amount.toFixed(2)}
                </option>
              ))}
            </select>
            {matchedTransaction && (
              <p className="text-xs text-slate-500">
                Uses this transaction&apos;s own amount and bank account — avoids recording the
                same deposit twice.
              </p>
            )}
          </div>
        )}

        <input
          type="number"
          step="0.01"
          min="0"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
          readOnly={Boolean(bankTransactionId)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm read-only:bg-slate-50"
        />

        {!bankTransactionId && (
          <select
            value={depositAccountId}
            onChange={(e) => setDepositAccountId(e.target.value)}
            required
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Deposit to…</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {formatAccountLabel(account, showAccountCodes)}
              </option>
            ))}
          </select>
        )}

        <input
          type="date"
          value={paymentDate}
          onChange={(e) => setPaymentDate(e.target.value)}
          required
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />

        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {isSubmitting ? "Saving…" : "Receive Payment"}
        </button>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>
    </div>
  );
}
