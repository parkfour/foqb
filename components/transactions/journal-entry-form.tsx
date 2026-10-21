"use client";

import { useState, type FormEvent } from "react";
import { useOnlineStatus } from "@/components/providers/online-status-provider";
import { saveOfflineEntry } from "@/lib/db/offline";
import { formatAccountLabel } from "@/lib/accounts/format";
import { useBookToday } from "@/components/providers/book-clock-provider";
import { TimezoneChangeNotice } from "@/components/ui/timezone-change-notice";

interface AccountOption {
  id: string;
  account_number: string;
  name: string;
}

interface LineDraft {
  accountId: string;
  debit: string;
  credit: string;
}

function emptyLine(): LineDraft {
  return { accountId: "", debit: "", credit: "" };
}

export function JournalEntryForm({
  organizationId,
  accounts,
  showAccountCodes = true,
}: {
  organizationId: string;
  accounts: AccountOption[];
  showAccountCodes?: boolean;
}) {
  const isOnline = useOnlineStatus();
  const today = useBookToday();
  const [entryDate, setEntryDate] = useState(today);
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine(), emptyLine()]);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(
    null,
  );
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

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setStatus(null);

    const parsedLines = lines
      .filter((line) => line.accountId)
      .map((line) => ({
        account_id: line.accountId,
        debit: Number(line.debit || 0),
        credit: Number(line.credit || 0),
      }));

    const totalDebit = parsedLines.reduce((sum, l) => sum + l.debit, 0);
    const totalCredit = parsedLines.reduce((sum, l) => sum + l.credit, 0);

    if (parsedLines.length < 2) {
      setStatus({ type: "error", message: "Add at least two lines" });
      return;
    }

    if (Math.round(totalDebit * 100) !== Math.round(totalCredit * 100) || totalDebit === 0) {
      setStatus({
        type: "error",
        message: "Total debits must equal total credits and be greater than zero",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      if (isOnline) {
        const response = await fetch("/api/journal-entries", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organization_id: organizationId,
            entry_date: entryDate,
            memo,
            lines: parsedLines,
          }),
        });

        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? "Failed to save entry");
        }

        setStatus({ type: "success", message: "Entry posted" });
      } else {
        await saveOfflineEntry({
          organization_id: organizationId,
          entry_date: entryDate,
          memo,
          lines: parsedLines,
        });
        setStatus({
          type: "success",
          message: "Saved offline — will sync when you're back online",
        });
      }

      setMemo("");
      setLines([emptyLine(), emptyLine()]);
    } catch (error: unknown) {
      setStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to save entry",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-slate-900">New Journal Entry</h2>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <TimezoneChangeNotice from={entryDate} />
        <div className="flex flex-wrap gap-3">
          <input
            type="date"
            value={entryDate}
            onChange={(e) => setEntryDate(e.target.value)}
            required
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="Memo"
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="flex flex-col gap-2">
          {lines.map((line, index) => (
            <div key={index} className="flex flex-wrap items-center gap-2">
              <select
                value={line.accountId}
                onChange={(e) => updateLine(index, { accountId: e.target.value })}
                className="min-w-[220px] flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">Select account…</option>
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
                placeholder="Debit"
                value={line.debit}
                onChange={(e) => updateLine(index, { debit: e.target.value, credit: "" })}
                className="w-28 rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="Credit"
                value={line.credit}
                onChange={(e) => updateLine(index, { credit: e.target.value, debit: "" })}
                className="w-28 rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              {lines.length > 2 && (
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
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {isSubmitting ? "Saving…" : isOnline ? "Post Entry" : "Save Offline"}
          </button>
        </div>

        {status && (
          <p
            className={`text-sm ${status.type === "error" ? "text-red-600" : "text-emerald-700"}`}
          >
            {status.message}
          </p>
        )}
      </form>
    </div>
  );
}
