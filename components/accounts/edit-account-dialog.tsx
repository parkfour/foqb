"use client";

import { useActionState, useEffect, useRef } from "react";
import { updateAccount } from "@/app/(dashboard)/accounts/actions";
import type { ActionState } from "@/app/(dashboard)/actions";

const initialState: ActionState = { error: null };
const TYPES = ["asset", "liability", "equity", "revenue", "expense"] as const;

export function EditAccountDialog({
  account,
  showAccountCodes,
}: {
  account: { id: string; account_number: string; name: string; type: string; description: string | null };
  showAccountCodes: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, formAction, isPending] = useActionState(updateAccount, initialState);
  const submitted = useRef(false);

  // Close once a save succeeds.
  useEffect(() => {
    if (submitted.current && !isPending && !state.error) dialogRef.current?.close();
  }, [isPending, state]);

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className="text-xs text-slate-500 hover:text-slate-900"
      >
        Edit
      </button>
      <dialog
        ref={dialogRef}
        className="rounded-lg border border-slate-200 p-0 shadow-lg backdrop:bg-slate-900/40"
      >
        <form
          action={formAction}
          onSubmit={() => {
            submitted.current = true;
          }}
          className="flex w-80 flex-col gap-3 p-5 text-sm"
        >
          <h2 className="text-sm font-semibold text-slate-900">Edit &ldquo;{account.name}&rdquo;</h2>
          <input type="hidden" name="id" value={account.id} />
          {showAccountCodes && (
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              Number
              <input
                name="accountNumber"
                defaultValue={account.account_number}
                required
                maxLength={20}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              />
            </label>
          )}
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            Name
            <input
              name="name"
              defaultValue={account.name}
              required
              maxLength={100}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            Type
            <select
              name="type"
              defaultValue={account.type}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-normal capitalize"
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <span className="font-normal text-slate-500">Only while the account has no transactions.</span>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            Description
            <input
              name="description"
              defaultValue={account.description ?? ""}
              maxLength={500}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
            />
          </label>
          {state.error && <p className="rounded-md bg-red-50 p-2 text-xs text-red-700">{state.error}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="rounded-md px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
