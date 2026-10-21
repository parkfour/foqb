"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Filter, Search, SlidersHorizontal, Split as SplitIcon } from "lucide-react";
import { SplitTransactionModal } from "./split-transaction-modal";
import type { SplitLineInput } from "@/lib/transactions/split";
import {
  bookAllTransfersAction,
  bookTransferAction,
  reopenTransactionAction,
  recategorizeTransactionAction,
  savePayeeRuleAction,
  setRegisterClearedAction,
  splitBankTransactionAction,
} from "@/app/(dashboard)/transactions/actions";
import { createAccountQuickAction } from "@/app/(dashboard)/accounts/actions";
import { useMoney } from "@/components/providers/book-currency-provider";

export interface RegisterTransaction {
  id: string;
  date: string;
  account_id: string;
  account_name: string;
  name: string | null;
  amount: number;
  category_id?: string | null;
  category_name: string;
  is_split: boolean;
  // "reconciled" only when a bank reconciliation covers it; cleared is the
  // checkbook mark the person toggles.
  status: "pending" | "cleared" | "reconciled";
  // Already booked to an account. Only uncategorized transactions can be
  // categorized or split here.
  categorized: boolean;
  journal_entry_id?: string | null;
  // Why a categorized row can't be re-opened (payment, reconciliation,
  // locked period), or null if it can.
  reopen_blocker?: string | null;
  // Why a categorized row's category can't be changed in place (a split, a
  // transfer, a payment, a locked period), or null if it can, reconciled
  // or not.
  recategorize_blocker?: string | null;
  // The other side of a transfer between two linked accounts, when this
  // uncategorized row looks like one.
  transfer?: { account_id: string; account_name: string };
}

type ActionResult = { success: boolean; error?: string };

export interface RegisterAccount {
  id: string;
  account_number?: string;
  name: string;
  type?: string;
}

export interface TransactionRegisterProps {
  transactions: RegisterTransaction[];
  accounts: RegisterAccount[];
  canWrite?: boolean;
  // The account the page loaded in full; "all" when it loaded every account.
  account?: string;
  // Where "Load older" goes; null when the oldest transaction is listed.
  olderHref?: string | null;
  onClearedToggle?: (id: string, cleared: boolean) => Promise<ActionResult>;
  onSplitSave?: (transactionId: string, splits: SplitLineInput[]) => Promise<ActionResult>;
  onReopen?: (transactionId: string) => Promise<ActionResult>;
  onRecategorize?: (transactionId: string, accountId: string) => Promise<ActionResult & { journalEntryId?: string }>;
  onTransfer?: (transactionId: string, otherAccountId: string) => Promise<ActionResult>;
  onBookAllTransfers?: () => Promise<ActionResult & { bookedIds?: string[] }>;
  onSavePayeeRule?: (
    transactionId: string,
    matchText: string,
    targetAccountId: string,
  ) => Promise<ActionResult & { categorizedIds?: string[] }>;
  onCreateAccount?: (name: string, type: string) => Promise<ActionResult & { account?: RegisterAccount }>;
}

const NEW_ACCOUNT = "__new__";
const ACCOUNT_TYPES = [
  ["expense", "Expense"],
  ["revenue", "Income"],
  ["asset", "Asset"],
  ["liability", "Liability"],
  ["equity", "Equity"],
] as const;

// The "+ New account…" form under a row: created, then the row goes to it.
interface NewAccountForm {
  transactionId: string;
  name: string;
  type: string;
}

// Offered after a row is categorized by hand: categorize this payee the
// same way from now on, and the matching rows already listed.
interface PayeePrompt {
  transactionId: string;
  accountId: string;
  accountName: string;
  text: string;
}

export function TransactionRegister({
  transactions: initialTransactions,
  accounts: initialAccounts,
  canWrite = true,
  account = "all",
  olderHref = null,
  onClearedToggle = setRegisterClearedAction,
  onSplitSave = splitBankTransactionAction,
  onReopen = reopenTransactionAction,
  onRecategorize = recategorizeTransactionAction,
  onTransfer = bookTransferAction,
  onBookAllTransfers = bookAllTransfersAction,
  onSavePayeeRule = savePayeeRuleAction,
  onCreateAccount = createAccountQuickAction,
}: TransactionRegisterProps) {
  const formatCurrency = useMoney();
  const [transactions, setTransactions] = useState<RegisterTransaction[]>(initialTransactions);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [payeePrompt, setPayeePrompt] = useState<PayeePrompt | null>(null);
  const [accounts, setAccounts] = useState<RegisterAccount[]>(initialAccounts);
  const [newAccount, setNewAccount] = useState<NewAccountForm | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const router = useRouter();
  const [accountFilter, setAccountFilter] = useState<string>(account);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  // Split modal state
  const [activeSplitTx, setActiveSplitTx] = useState<RegisterTransaction | null>(null);

  // Filter transactions
  const filtered = useMemo(() => {
    return transactions.filter((tx) => {
      if (accountFilter !== "all" && tx.account_id !== accountFilter) {
        return false;
      }
      if (statusFilter !== "all" && tx.status !== statusFilter) {
        return false;
      }
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const payee = (tx.name || "").toLowerCase();
        const cat = (tx.category_name || "").toLowerCase();
        const acc = (tx.account_name || "").toLowerCase();
        if (!payee.includes(term) && !cat.includes(term) && !acc.includes(term)) {
          return false;
        }
      }
      return true;
    });
  }, [transactions, accountFilter, statusFilter, searchTerm]);

  // Compute running balance chronologically
  const rowsWithBalance = useMemo(() => {
    // Sort ascending by date to compute balance, then keep display order
    const sorted = [...filtered].sort((a, b) => a.date.localeCompare(b.date));
    let running = 0;
    const balanceMap = new Map<string, number>();

    for (const tx of sorted) {
      const outflow = tx.amount < 0 ? Math.abs(tx.amount) : 0;
      const inflow = tx.amount > 0 ? tx.amount : 0;
      running += inflow - outflow;
      balanceMap.set(tx.id, running);
    }

    return filtered.map((tx) => ({
      ...tx,
      outflow: tx.amount < 0 ? Math.abs(tx.amount) : 0,
      inflow: tx.amount > 0 ? tx.amount : 0,
      running_balance: balanceMap.get(tx.id) ?? 0,
    }));
  }, [filtered]);

  // Optimistic: show the change at once, put the row back if it fails.
  async function applyChange(
    tx: RegisterTransaction,
    changed: RegisterTransaction,
    save: () => Promise<ActionResult>,
  ): Promise<boolean> {
    setError(null);
    setNotice(null);
    setTransactions((prev) => prev.map((t) => (t.id === tx.id ? changed : t)));
    const result = await save().catch((err: unknown) => ({
      success: false,
      error: err instanceof Error ? err.message : "Couldn't save the change",
    }));
    if (!result.success) {
      setTransactions((prev) => prev.map((t) => (t.id === tx.id ? tx : t)));
      setError(result.error ?? "Couldn't save the change");
    }
    return result.success;
  }

  async function handleToggleStatus(tx: RegisterTransaction) {
    if (!canWrite || tx.status === "reconciled") return;
    const cleared = tx.status !== "cleared";
    await applyChange(tx, { ...tx, status: cleared ? "cleared" : "pending" }, () => onClearedToggle(tx.id, cleared));
  }

  // A one-line split is a plain categorization.
  async function handleCategorySelect(tx: RegisterTransaction, newAccountId: string, newAccountName?: string) {
    if (!canWrite || tx.categorized || !newAccountId) return;
    if (newAccountId === NEW_ACCOUNT) {
      setNewAccount({ transactionId: tx.id, name: "", type: tx.amount < 0 ? "expense" : "revenue" });
      return;
    }
    const accountName = newAccountName ?? accounts.find((a) => a.id === newAccountId)?.name ?? "Categorized";
    const saved = await applyChange(
      tx,
      { ...tx, categorized: true, category_id: newAccountId, category_name: accountName },
      () => onSplitSave(tx.id, [{ account_id: newAccountId, amount: Math.abs(tx.amount) }]),
    );
    if (saved && tx.name) {
      setPayeePrompt({ transactionId: tx.id, accountId: newAccountId, accountName, text: tx.name });
    }
  }

  async function handleCreateAccount(tx: RegisterTransaction) {
    if (!newAccount) return;
    const form = newAccount;
    setError(null);
    const result = await onCreateAccount(form.name, form.type).catch((err: unknown) => ({
      success: false,
      error: err instanceof Error ? err.message : "Couldn't create the account",
      account: undefined,
    }));
    if (!result.success || !result.account) {
      setError(result.error ?? "Couldn't create the account");
      return;
    }
    const created = result.account;
    setAccounts((prev) =>
      [...prev, created].sort((a, b) => (a.account_number ?? "").localeCompare(b.account_number ?? "")),
    );
    setNewAccount(null);
    await handleCategorySelect(tx, created.id, created.name);
  }

  // The uncategorized rows listed that a payee rule with this text would
  // match: the database's case-insensitive "contains".
  const promptMatches = payeePrompt
    ? transactions.filter(
        (t) =>
          !t.categorized &&
          payeePrompt.text.trim() !== "" &&
          (t.name ?? "").toLowerCase().includes(payeePrompt.text.trim().toLowerCase()),
      ).length
    : 0;

  async function handleSavePayeeRule() {
    if (!payeePrompt) return;
    const prompt = payeePrompt;
    setError(null);
    const result = await onSavePayeeRule(prompt.transactionId, prompt.text, prompt.accountId).catch((err: unknown) => ({
      success: false,
      error: err instanceof Error ? err.message : "Couldn't save the rule",
      categorizedIds: undefined,
    }));
    if (!result.success) {
      setError(result.error ?? "Couldn't save the rule");
      return;
    }
    const ids = new Set(result.categorizedIds ?? []);
    setTransactions((prev) =>
      prev.map((t) =>
        ids.has(t.id)
          ? { ...t, categorized: true, transfer: undefined, category_id: prompt.accountId, category_name: prompt.accountName }
          : t,
      ),
    );
    setPayeePrompt(null);
    setNotice(
      `Rule saved: payees containing “${prompt.text.trim()}” go to ${prompt.accountName}. ` +
        `${ids.size} more transaction${ids.size === 1 ? "" : "s"} categorized.`,
    );
  }

  const waitingTransfers = transactions.filter((t) => !t.categorized && t.transfer && t.amount < 0).length;

  async function handleBookAllTransfers() {
    setError(null);
    setNotice(null);
    const result = await onBookAllTransfers().catch((err: unknown) => ({
      success: false,
      error: err instanceof Error ? err.message : "Couldn't book the transfers",
      bookedIds: undefined,
    }));
    if (!result.success) {
      setError(result.error ?? "Couldn't book the transfers");
      return;
    }
    const ids = new Set(result.bookedIds ?? []);
    setTransactions((prev) =>
      prev.map((t) =>
        ids.has(t.id) && t.transfer
          ? { ...t, categorized: true, transfer: undefined, category_id: t.transfer.account_id, category_name: t.transfer.account_name }
          : t,
      ),
    );
    setNotice(`${ids.size / 2} transfer${ids.size === 2 ? "" : "s"} booked.`);
  }

  // Both actions change two rows for a transfer, so they update the list
  // after the server answers rather than optimistically.
  async function runAndUpdate(save: () => Promise<ActionResult>, update: (t: RegisterTransaction) => RegisterTransaction) {
    setError(null);
    const result = await save().catch((err: unknown) => ({
      success: false,
      error: err instanceof Error ? err.message : "Couldn't save the change",
    }));
    if (result.success) setTransactions((prev) => prev.map(update));
    else setError(result.error ?? "Couldn't save the change");
  }

  // A new category for a categorized row, reconciled or not.
  async function handleRecategorize(tx: RegisterTransaction, accountId: string) {
    if (!canWrite || !accountId || accountId === tx.category_id) return;
    const accountName = accounts.find((a) => a.id === accountId)?.name ?? "Categorized";
    let journalEntryId: string | undefined;
    const saved = await applyChange(tx, { ...tx, category_id: accountId, category_name: accountName }, async () => {
      const result = await onRecategorize(tx.id, accountId);
      journalEntryId = result.journalEntryId;
      return result;
    });
    if (saved && journalEntryId) {
      setTransactions((prev) => prev.map((t) => (t.id === tx.id ? { ...t, journal_entry_id: journalEntryId } : t)));
    }
  }

  async function handleReopen(tx: RegisterTransaction) {
    const reopened = (t: RegisterTransaction): RegisterTransaction =>
      t.id === tx.id || (tx.journal_entry_id && t.journal_entry_id === tx.journal_entry_id)
        ? { ...t, categorized: false, is_split: false, category_id: null, category_name: "Uncategorized", journal_entry_id: null }
        : t;
    await runAndUpdate(() => onReopen(tx.id), reopened);
  }

  async function handleTransfer(tx: RegisterTransaction) {
    const other = tx.transfer;
    if (!other) return;
    await runAndUpdate(
      () => onTransfer(tx.id, other.account_id),
      (t) =>
        t.id === tx.id
          ? { ...t, categorized: true, transfer: undefined, category_id: other.account_id, category_name: other.account_name }
          : t.transfer && t.account_id === other.account_id && t.transfer.account_id === tx.account_id
            ? { ...t, categorized: true, transfer: undefined, category_id: tx.account_id, category_name: tx.account_name }
            : t,
    );
  }

  async function handleSaveSplit(splits: SplitLineInput[]) {
    if (!activeSplitTx) return;
    const tx = activeSplitTx;
    await applyChange(tx, { ...tx, categorized: true, is_split: true, category_name: "Split" }, () =>
      onSplitSave(tx.id, splits),
    );
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTableSectionElement>) {
    if (rowsWithBalance.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) =>
        prev === null || prev >= rowsWithBalance.length - 1 ? 0 : prev + 1,
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) =>
        prev === null || prev <= 0 ? rowsWithBalance.length - 1 : prev - 1,
      );
    } else if (e.key === "Enter" && selectedIndex !== null) {
      e.preventDefault();
      const current = rowsWithBalance[selectedIndex];
      if (current) {
        setActiveSplitTx(current);
      }
    } else if (e.key === "Escape") {
      setSelectedIndex(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Search & Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-1 items-center gap-2 min-w-[200px] max-w-md">
          <div className="relative w-full">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search payee, category, account…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-md border border-slate-300 py-1.5 pl-8 pr-3 text-xs text-slate-800 placeholder-slate-400 focus:border-slate-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <Filter className="h-3.5 w-3.5 text-slate-400" />
            <select
              aria-label="Filter by account"
              value={accountFilter}
              onChange={(e) => {
                setAccountFilter(e.target.value);
                // Reload with that account's whole history, not just the
                // part of it in the newest page.
                router.push(e.target.value === "all" ? "/register" : `/register?account=${e.target.value}`);
              }}
              className="rounded-md border border-slate-300 py-1.5 pl-2 pr-6 text-xs text-slate-700 hover:bg-slate-50 focus:border-slate-500 focus:outline-none"
            >
              <option value="all">All Accounts</option>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <SlidersHorizontal className="h-3.5 w-3.5 text-slate-400" />
            <select
              aria-label="Filter by status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-md border border-slate-300 py-1.5 pl-2 pr-6 text-xs text-slate-700 hover:bg-slate-50 focus:border-slate-500 focus:outline-none"
            >
              <option value="all">All Statuses</option>
              <option value="pending">Not cleared</option>
              <option value="cleared">Cleared</option>
              <option value="reconciled">Reconciled</option>
            </select>
          </div>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-emerald-700">
          {notice}
        </p>
      )}

      {canWrite && waitingTransfers > 0 && (
        <button
          type="button"
          onClick={handleBookAllTransfers}
          className="self-start rounded-md border border-sky-300 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-800 hover:bg-sky-100"
          title="Book each matched pair of transfer rows as one transfer"
        >
          Book all {waitingTransfers} matched transfer{waitingTransfers === 1 ? "" : "s"}
        </button>
      )}

      {/* Dense Register Table */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-700">
            <tr>
              <th className="py-2.5 pl-4 pr-3">Date</th>
              <th className="px-3 py-2.5">Account</th>
              <th className="px-3 py-2.5">Payee / Merchant</th>
              <th className="px-3 py-2.5">Category / Split</th>
              <th className="px-3 py-2.5 text-center">Status</th>
              <th className="px-3 py-2.5 text-right">Outflow</th>
              <th className="px-3 py-2.5 text-right">Inflow</th>
              <th
                className="py-2.5 pl-3 pr-4 text-right"
                title="Running total of the transactions listed, for the selected account"
              >
                Running total
              </th>
              <th className="py-2.5 pl-2 pr-3 text-center w-12">Split</th>
            </tr>
          </thead>
          <tbody
            tabIndex={0}
            onKeyDown={handleKeyDown}
            className="divide-y divide-slate-100 outline-none focus:ring-1 focus:ring-blue-500/30"
          >
            {rowsWithBalance.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-8 text-center text-sm text-slate-500">
                  No register transactions found.
                </td>
              </tr>
            ) : (
              rowsWithBalance.map((tx, idx) => {
                const isSelected = selectedIndex === idx;
                return (
                  <Fragment key={tx.id}>
                  <tr
                    onClick={() => setSelectedIndex(idx)}
                    className={`cursor-pointer transition-colors ${
                      isSelected
                        ? "bg-blue-50/80 font-medium text-slate-900"
                        : "hover:bg-slate-50/70 text-slate-700"
                    }`}
                  >
                    <td className="py-2 pl-4 pr-3 font-mono text-[11px] text-slate-600 whitespace-nowrap">
                      {tx.date}
                    </td>
                    <td className="px-3 py-2 font-medium text-slate-800 whitespace-nowrap">
                      {tx.account_name}
                    </td>
                    <td className="px-3 py-2 max-w-[200px] truncate" title={tx.name || ""}>
                      {tx.name || "—"}
                    </td>
                    <td className="px-3 py-2 min-w-[160px]">
                      {tx.is_split ? (
                        <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                          <SplitIcon className="h-3 w-3" />
                          Split
                        </span>
                      ) : canWrite && !tx.categorized ? (
                        <select
                          aria-label={`Category for ${tx.name || tx.id}`}
                          value={tx.category_id || ""}
                          onChange={(e) => {
                            e.stopPropagation();
                            handleCategorySelect(tx, e.target.value);
                          }}
                          className="w-full rounded border border-slate-200 bg-white py-0.5 text-xs text-slate-800 hover:border-slate-400 focus:border-slate-500 focus:outline-none"
                        >
                          <option value="">{tx.category_name || "Uncategorized"}</option>
                          {accounts.map((acc) => (
                            <option key={acc.id} value={acc.id}>
                              {acc.account_number ? `${acc.account_number} — ` : ""}
                              {acc.name}
                            </option>
                          ))}
                          <option value={NEW_ACCOUNT}>+ New account…</option>
                        </select>
                      ) : (
                        <span className="flex items-center gap-2">
                          {canWrite && tx.categorized && !tx.recategorize_blocker ? (
                            // Changing the category keeps the bank side, so it's
                            // open even once reconciled.
                            <select
                              aria-label={`Change category for ${tx.name || tx.id}`}
                              value={tx.category_id || ""}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => {
                                e.stopPropagation();
                                handleRecategorize(tx, e.target.value);
                              }}
                              title="Change the category"
                              className="w-full rounded border border-slate-200 bg-white py-0.5 text-xs text-slate-800 hover:border-slate-400 focus:border-slate-500 focus:outline-none"
                            >
                              {!accounts.some((a) => a.id === tx.category_id) && (
                                <option value={tx.category_id || ""}>{tx.category_name}</option>
                              )}
                              {accounts
                                .filter((acc) => acc.id !== tx.account_id)
                                .map((acc) => (
                                  <option key={acc.id} value={acc.id}>
                                    {acc.account_number ? `${acc.account_number} — ` : ""}
                                    {acc.name}
                                  </option>
                                ))}
                            </select>
                          ) : (
                            <span title={canWrite && tx.categorized ? (tx.recategorize_blocker ?? undefined) : undefined}>
                              {tx.category_name}
                            </span>
                          )}
                          {canWrite && tx.categorized && tx.status !== "reconciled" && !tx.reopen_blocker && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleReopen(tx);
                              }}
                              className="whitespace-nowrap text-[11px] text-slate-400 hover:text-slate-900"
                              title="Void the entry and send it back to be categorized (or split) again"
                            >
                              Re-open
                            </button>
                          )}
                        </span>
                      )}
                      {canWrite && !tx.categorized && tx.transfer && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleTransfer(tx);
                          }}
                          className="mt-1 rounded border border-sky-300 bg-sky-50 px-1.5 py-0.5 text-[11px] font-medium text-sky-800 hover:bg-sky-100"
                          title="Book both sides as one transfer"
                        >
                          Transfer {tx.amount < 0 ? "to" : "from"} {tx.transfer.account_name}
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center whitespace-nowrap">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleStatus(tx);
                        }}
                        className={`inline-block min-w-[20px] rounded px-1.5 py-0.5 text-[11px] font-bold ${
                          tx.status === "reconciled"
                            ? "bg-emerald-100 text-emerald-800"
                            : tx.status === "cleared"
                            ? "bg-blue-100 text-blue-800"
                            : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                        }`}
                        title={
                          tx.status === "reconciled"
                            ? "Reconciled against a bank statement"
                            : `${tx.status === "cleared" ? "Cleared" : "Not cleared"}. Click to change.`
                        }
                      >
                        {tx.status === "reconciled" ? "R" : tx.status === "cleared" ? "C" : "P"}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-[11px] text-slate-800 whitespace-nowrap">
                      {tx.outflow > 0 ? formatCurrency(tx.outflow) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-[11px] text-emerald-700 font-medium whitespace-nowrap">
                      {tx.inflow > 0 ? formatCurrency(tx.inflow) : "—"}
                    </td>
                    <td className="py-2 pl-3 pr-4 text-right font-mono text-[11px] font-semibold text-slate-900 whitespace-nowrap">
                      {accountFilter === "all" ? "—" : formatCurrency(tx.running_balance)}
                    </td>
                    <td className="py-2 pl-2 pr-3 text-center">
                      {canWrite && !tx.categorized && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveSplitTx(tx);
                          }}
                          className="rounded p-1 text-slate-400 hover:bg-slate-200/60 hover:text-slate-700"
                          title="Split transaction"
                          aria-label={`Split ${tx.name || "transaction"}`}
                        >
                          <SplitIcon className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                  {canWrite && newAccount?.transactionId === tx.id && (
                    <tr>
                      <td colSpan={9} className="px-4 pb-2">
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            handleCreateAccount(tx);
                          }}
                          className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800"
                        >
                          <label htmlFor={`new-account-${tx.id}`}>New account</label>
                          <input
                            id={`new-account-${tx.id}`}
                            type="text"
                            value={newAccount.name}
                            maxLength={100}
                            autoFocus
                            placeholder="Name"
                            onChange={(e) => setNewAccount({ ...newAccount, name: e.target.value })}
                            className="min-w-[160px] flex-1 rounded border border-slate-300 px-2 py-1 text-xs focus:border-slate-500 focus:outline-none"
                          />
                          <select
                            aria-label="New account type"
                            value={newAccount.type}
                            onChange={(e) => setNewAccount({ ...newAccount, type: e.target.value })}
                            className="rounded border border-slate-300 py-1 pl-2 pr-6 text-xs focus:border-slate-500 focus:outline-none"
                          >
                            {ACCOUNT_TYPES.map(([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                          </select>
                          <button
                            type="submit"
                            disabled={newAccount.name.trim() === ""}
                            className="rounded-md bg-slate-900 px-2.5 py-1 font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                          >
                            Create and categorize
                          </button>
                          <button
                            type="button"
                            onClick={() => setNewAccount(null)}
                            className="rounded-md px-2 py-1 text-slate-500 hover:text-slate-900"
                          >
                            Cancel
                          </button>
                        </form>
                      </td>
                    </tr>
                  )}
                  {canWrite && payeePrompt?.transactionId === tx.id && (
                    <tr>
                      <td colSpan={9} className="px-4 pb-2">
                      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-slate-800">
                        <label htmlFor="payee-rule-text">Always categorize payees containing</label>
                        <input
                          id="payee-rule-text"
                          type="text"
                          value={payeePrompt.text}
                          maxLength={255}
                          onChange={(e) => setPayeePrompt({ ...payeePrompt, text: e.target.value })}
                          className="min-w-[180px] flex-1 rounded border border-slate-300 px-2 py-1 text-xs focus:border-slate-500 focus:outline-none"
                        />
                        <span>
                          as <strong>{payeePrompt.accountName}</strong>?{" "}
                          {promptMatches > 0 &&
                            `This also categorizes the ${promptMatches} matching uncategorized transaction${promptMatches === 1 ? "" : "s"} listed.`}
                        </span>
                        <button
                          type="button"
                          onClick={handleSavePayeeRule}
                          disabled={payeePrompt.text.trim() === ""}
                          className="rounded-md bg-slate-900 px-2.5 py-1 font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                        >
                          Save rule
                        </button>
                        <button
                          type="button"
                          onClick={() => setPayeePrompt(null)}
                          className="rounded-md px-2 py-1 text-slate-500 hover:text-slate-900"
                        >
                          No thanks
                        </button>
                      </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {olderHref && (
        <Link
          href={olderHref}
          scroll={false}
          className="self-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
        >
          Load older
        </Link>
      )}

      {/* Split Modal */}
      <SplitTransactionModal
        isOpen={Boolean(activeSplitTx)}
        onClose={() => setActiveSplitTx(null)}
        transaction={activeSplitTx}
        accounts={accounts}
        onSave={handleSaveSplit}
      />
    </div>
  );
}
