"use client";

import { useActionState } from "react";
import { createAccount } from "@/app/(dashboard)/accounts/actions";
import type { ActionState } from "@/app/(dashboard)/actions";

interface TaxLineOption {
  id: string;
  code: string;
  label: string;
}

const ACCOUNT_TYPES = ["asset", "liability", "equity", "revenue", "expense"] as const;
const initialState: ActionState = { error: null };

export function NewAccountForm({
  organizationId,
  showAccountCodes,
  taxLines = [],
}: {
  organizationId: string;
  showAccountCodes: boolean;
  taxLines?: TaxLineOption[];
}) {
  const [state, formAction, isPending] = useActionState(createAccount, initialState);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-slate-900">New Account</h2>
      <form action={formAction} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <input type="hidden" name="organizationId" value={organizationId} />
        {showAccountCodes && (
          <input
            name="accountNumber"
            placeholder="Account number"
            required
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        )}
        <input
          name="name"
          placeholder="Name"
          required
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <select
          name="type"
          required
          defaultValue="asset"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          {ACCOUNT_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <input
          name="description"
          placeholder="Description (optional)"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        {taxLines.length > 0 && (
          <select
            name="taxLineId"
            defaultValue=""
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Tax line (optional)</option>
            {taxLines.map((t) => (
              <option key={t.id} value={t.id}>
                {t.code} — {t.label}
              </option>
            ))}
          </select>
        )}
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {isPending ? "Adding…" : "Add Account"}
        </button>
      </form>
      {state.error && <p className="mt-2 text-sm text-red-600">{state.error}</p>}
    </div>
  );
}
