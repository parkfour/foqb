"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { formatAccountLabel } from "@/lib/accounts/format";

interface VendorOption {
  id: string;
  name: string;
}

interface BillOption {
  id: string;
  billNumber: string;
  vendorId: string;
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

export function MakePaymentForm({
  vendors,
  bills,
  accounts,
  bankTransactions,
  showAccountCodes = true,
}: {
  vendors: VendorOption[];
  bills: BillOption[];
  accounts: AccountOption[];
  bankTransactions: BankTransactionOption[];
  showAccountCodes?: boolean;
}) {
  const router = useRouter();
  const [vendorId, setVendorId] = useState("");
  const [billId, setBillId] = useState("");
  const [bankTransactionId, setBankTransactionId] = useState("");
  const [amount, setAmount] = useState("");
  const [paymentAccountId, setPaymentAccountId] = useState("");
  const [paymentDate, setPaymentDate] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const vendorBills = useMemo(
    () => bills.filter((bill) => bill.vendorId === vendorId),
    [bills, vendorId],
  );
  const selectedBill = vendorBills.find((bill) => bill.id === billId);
  const matchedTransaction = bankTransactions.find((tx) => tx.id === bankTransactionId);

  function selectBankTransaction(id: string) {
    setBankTransactionId(id);
    const tx = bankTransactions.find((t) => t.id === id);
    setAmount(tx ? String(Math.abs(tx.amount)) : "");
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!billId || !amount || (!bankTransactionId && !paymentAccountId)) {
      setError("Bill, amount, and a payment account or matched bank transaction are required");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/bill-payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bill_id: billId,
          payment_date: paymentDate,
          amount: Number(amount),
          payment_account_id: paymentAccountId || null,
          bank_transaction_id: bankTransactionId || null,
        }),
      });

      if (!response.ok) {
        const responseBody = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(responseBody.error ?? "Failed to record payment");
      }

      router.push("/vendors");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to record payment");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-lg font-semibold text-slate-900">Make Payment</h1>
      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
        <select
          value={vendorId}
          onChange={(e) => {
            setVendorId(e.target.value);
            setBillId("");
          }}
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
          value={billId}
          onChange={(e) => setBillId(e.target.value)}
          required
          disabled={!vendorId}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
        >
          <option value="">{vendorId ? "Open bill…" : "Select a vendor first"}</option>
          {vendorBills.map((bill) => (
            <option key={bill.id} value={bill.id}>
              {bill.billNumber} — ${bill.remaining.toFixed(2)} remaining
            </option>
          ))}
        </select>

        {selectedBill && (
          <p className="text-sm text-slate-500">
            Remaining balance: ${selectedBill.remaining.toFixed(2)}
          </p>
        )}

        {bankTransactions.length > 0 && (
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-slate-700">
              Match to a bank withdrawal (optional)
            </label>
            <select
              value={bankTransactionId}
              onChange={(e) => selectBankTransaction(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">None — enter manually</option>
              {bankTransactions.map((tx) => (
                <option key={tx.id} value={tx.id}>
                  {tx.date} — {tx.name ?? "Withdrawal"} — ${Math.abs(tx.amount).toFixed(2)}
                </option>
              ))}
            </select>
            {matchedTransaction && (
              <p className="text-xs text-slate-500">
                Uses this transaction&apos;s own amount and bank account — avoids recording the
                same withdrawal twice.
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
            value={paymentAccountId}
            onChange={(e) => setPaymentAccountId(e.target.value)}
            required
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Pay from…</option>
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
          {isSubmitting ? "Saving…" : "Make Payment"}
        </button>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>
    </div>
  );
}
