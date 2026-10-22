// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SlotComponent, SlotContextMap } from "@/lib/plugins/types";
import { getPlugins } from "@/lib/plugins/hooks";
import { parseStatement, statementDifference, type ParsedStatement } from "./parse";
import { readStatementLines } from "./read-statement";
import { importStatementAction } from "./actions";
import { createAccountQuickAction } from "@/app/(dashboard)/accounts/actions";
import type { ImportResult } from "./import";
import { useMoney } from "@/components/providers/book-currency-provider";

type Account = SlotContextMap["reconcile.header"]["accounts"][number];

// The account a statement most likely belongs to: the right type, with the
// statement's last four digits in its name (linked accounts are "Name ••1234").
// A statement without an account number (a workplace plan's) is picked by hand.
export function guessAccount(statement: ParsedStatement, accounts: Account[]): string {
  const type = statement.kind === "card" ? "liability" : "asset";
  if (!statement.accountLast4) return "";
  return accounts.find((a) => a.type === type && a.name.includes(statement.accountLast4))?.id ?? "";
}

// "Name ••1234", or just the name when the statement shows no number.
const labelOf = (statement: ParsedStatement) =>
  statement.accountLast4 ? `${statement.accountName} ••${statement.accountLast4}` : statement.accountName;

// A statement for an account the book doesn't have yet: created on import.
const NEW_ACCOUNT = "__new__";

interface Found {
  statement: ParsedStatement;
  accountId: string;
  newName: string;
  // Close the account's history before this statement at its opening balance.
  settleBefore: boolean;
  result?: ImportResult;
  busy?: boolean;
}

function resultText(r: ImportResult): string {
  const parts = [`${r.added} added`];
  if (r.alreadyThere) parts.push(`${r.alreadyThere} already in the register`);
  if (r.uncategorized) parts.push(`${r.uncategorized} to categorize`);
  return `${parts.join(", ")}. ${r.reconciled ? "Statement reconciled." : ""}`;
}

export const StatementImporter: SlotComponent<"reconcile.header"> = ({ context }) => {
  const formatCurrency = useMoney();
  const router = useRouter();
  const [found, setFound] = useState<Found[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState<string | null>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setFound([]);
    setReading("Reading…");
    try {
      const readers = getPlugins().flatMap((p) => p.statementReaders ?? []);
      const statements = parseStatement(await readStatementLines(file, setReading), readers);
      setFound(
        statements.map((statement) => ({
          statement,
          // Without a number to go by, nothing is chosen, rather than a new account.
          accountId: guessAccount(statement, context.accounts) || (statement.accountLast4 ? NEW_ACCOUNT : ""),
          newName: labelOf(statement),
          settleBefore: false,
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read that statement");
    } finally {
      setReading(null);
    }
  }

  function update(index: number, change: Partial<Found>) {
    setFound((prev) => prev.map((f, i) => (i === index ? { ...f, ...change } : f)));
  }

  async function handleImport(index: number) {
    const item = found[index];
    update(index, { busy: true });
    let accountId = item.accountId;
    if (accountId === NEW_ACCOUNT) {
      const created = await createAccountQuickAction(item.newName, item.statement.kind === "card" ? "liability" : "asset");
      if (!created.success || !created.account) {
        update(index, { busy: false, result: { success: false, error: created.error ?? "Couldn't create the account" } });
        return;
      }
      accountId = created.account.id;
      update(index, { accountId });
    }
    const result = await importStatementAction(accountId, item.statement, { settleBefore: item.settleBefore }).catch((err: unknown) => ({
      success: false,
      error: err instanceof Error ? err.message : "Couldn't import the statement",
    }));
    update(index, { busy: false, result });
    // Its transfers may have finished another statement imported earlier.
    const also = ("alsoReconciled" in result && result.alsoReconciled) || [];
    setFound((prev) =>
      prev.map((f, i) =>
        i !== index && f.result?.success && also.includes(f.accountId)
          ? { ...f, result: { ...f.result, uncategorized: 0, reconciled: true } }
          : f,
      ),
    );
    if (result.success) router.refresh();
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">Import a Statement</h2>
      <p className="mb-3 mt-1 text-xs text-slate-500">
        A bank or card statement PDF (Capital One and Bank of America for sure; others by a best guess), read on this device. Its transactions are added to the register
        (skipping ones already there), categorized by your rules, and the statement is reconciled once everything up
        to its date is categorized.
      </p>
      <input
        type="file"
        accept="application/pdf"
        aria-label="Statement PDF"
        disabled={reading !== null}
        onChange={(e) => {
          handleFile(e.target.files?.[0]);
          e.target.value = "";
        }}
        className="text-xs text-slate-700"
      />
      {reading && <p className="mt-2 text-xs text-slate-500">{reading}</p>}
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}

      {found.map(({ statement: s, accountId, newName, settleBefore, result, busy }, i) => {
        const difference = statementDifference(s);
        const accountType = s.kind === "card" ? "liability" : "asset";
        return (
          <div key={i} className="mt-3 flex flex-col gap-2 rounded-md border border-slate-100 p-3 text-xs text-slate-800">
            <p>
              <strong>
                {s.bank} {labelOf(s)}
              </strong>
              , {s.periodStart} to {s.periodEnd}: {s.rows.length} transactions, from{" "}
              {formatCurrency(s.openingBalance)} to {formatCurrency(s.closingBalance)}
              {s.kind === "card" ? " owed" : ""}.
            </p>
            {difference !== 0 ? (
              <p role="alert" className="text-red-600">
                The transactions read don&rsquo;t add up to the closing balance (off by {formatCurrency(difference)}),
                so this statement can&rsquo;t be imported.
              </p>
            ) : result?.success ? (
              <p role="status" className="text-emerald-700">
                {resultText(result)}{" "}
                {result.reconciliationId && !result.reconciled && (
                  <Link href={`/reconcile/${result.reconciliationId}`} className="underline">
                    Open the reconciliation
                  </Link>
                )}
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor={`statement-account-${i}`}>Into</label>
                <select
                  id={`statement-account-${i}`}
                  value={accountId}
                  onChange={(e) => update(i, { accountId: e.target.value })}
                  className="rounded border border-slate-300 py-1 pl-2 pr-6 text-xs focus:border-slate-500 focus:outline-none"
                >
                  <option value="">Choose an account…</option>
                  {context.accounts
                    .filter((a) => a.type === accountType)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  <option value={NEW_ACCOUNT}>+ New account</option>
                </select>
                {accountId === NEW_ACCOUNT && (
                  <input
                    type="text"
                    aria-label="New account name"
                    value={newName}
                    maxLength={100}
                    onChange={(e) => update(i, { newName: e.target.value })}
                    className="min-w-[180px] rounded border border-slate-300 px-2 py-1 text-xs focus:border-slate-500 focus:outline-none"
                  />
                )}
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={settleBefore}
                    onChange={(e) => update(i, { settleBefore: e.target.checked })}
                  />
                  Everything before {s.periodStart} is settled
                </label>
                <button
                  type="button"
                  disabled={!accountId || (accountId === NEW_ACCOUNT && newName.trim() === "") || busy}
                  onClick={() => handleImport(i)}
                  className="rounded-md bg-slate-900 px-2.5 py-1 font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                >
                  {busy ? "Importing…" : "Import"}
                </button>
                {result && !result.success && (
                  <span role="alert" className="text-red-600">
                    {result.error}
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
