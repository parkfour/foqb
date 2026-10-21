"use client";

import { useActionState } from "react";
import { createRule } from "@/app/(dashboard)/rules/actions";
import type { ActionState } from "@/app/(dashboard)/actions";
import { formatAccountLabel } from "@/lib/accounts/format";

interface AccountOption {
  id: string;
  account_number: string;
  name: string;
}

const MATCH_TYPES = ["contains", "starts_with", "exact", "regex"] as const;
const TRANSACTION_TYPES = ["any", "debit", "credit"] as const;
const initialState: ActionState = { error: null };

export function NewRuleForm({
  organizationId,
  accounts,
  showAccountCodes = true,
}: {
  organizationId: string;
  accounts: AccountOption[];
  showAccountCodes?: boolean;
}) {
  const [state, formAction, isPending] = useActionState(createRule, initialState);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-slate-900">New Rule</h2>
      <form action={formAction} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <input type="hidden" name="organizationId" value={organizationId} />

        <input
          name="ruleName"
          placeholder="Rule name"
          required
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />

        <select
          name="targetAccountId"
          required
          defaultValue=""
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="" disabled>
            Target account…
          </option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {formatAccountLabel(account, showAccountCodes)}
            </option>
          ))}
        </select>

        <select
          name="matchType"
          required
          defaultValue="contains"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          {MATCH_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>

        <input
          name="matchText"
          placeholder="Match text"
          required
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />

        <select
          name="transactionType"
          defaultValue="any"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          {TRANSACTION_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>

        <input
          name="minAmount"
          type="number"
          step="0.01"
          min="0"
          placeholder="Min amount (optional)"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />

        <input
          name="maxAmount"
          type="number"
          step="0.01"
          min="0"
          placeholder="Max amount (optional)"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />

        <input
          name="priority"
          type="number"
          min="1"
          placeholder="Priority (default 10)"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />

        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 sm:col-span-2 lg:col-span-1"
        >
          {isPending ? "Adding…" : "Add Rule"}
        </button>
      </form>
      {state.error && <p className="mt-2 text-sm text-red-600">{state.error}</p>}
    </div>
  );
}
