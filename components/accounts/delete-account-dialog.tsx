"use client";

import { useActionState, useRef } from "react";
import { deleteAccount, toggleAccountActive } from "@/app/(dashboard)/accounts/actions";
import type { ActionState } from "@/app/(dashboard)/actions";

const initialState: ActionState = { error: null };

export function DeleteAccountDialog({
  accountId,
  accountName,
  isActive,
}: {
  accountId: string;
  accountName: string;
  isActive: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, formAction, isPending] = useActionState(deleteAccount, initialState);

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className="text-xs text-red-600 hover:text-red-800"
      >
        Delete
      </button>
      <dialog
        ref={dialogRef}
        className="rounded-lg border border-slate-200 p-0 shadow-lg backdrop:bg-slate-900/40"
      >
        <div className="w-80 p-5">
          <h2 className="text-sm font-semibold text-slate-900">Delete &ldquo;{accountName}&rdquo;?</h2>
          <p className="mt-1 text-xs text-slate-500">
            This can&rsquo;t be undone. Accounts with existing transactions can&rsquo;t be deleted
            — deactivate them instead.
          </p>
          {state.error && (
            <div className="mt-3 rounded-md bg-red-50 p-2 text-xs text-red-700">
              {state.error}
              <form action={toggleAccountActive} className="mt-2">
                <input type="hidden" name="id" value={accountId} />
                <input type="hidden" name="isActive" value={String(isActive)} />
                <button type="submit" className="font-medium underline" onClick={() => dialogRef.current?.close()}>
                  Deactivate instead
                </button>
              </form>
            </div>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="rounded-md px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
            <form action={formAction}>
              <input type="hidden" name="id" value={accountId} />
              <button
                type="submit"
                disabled={isPending}
                className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {isPending ? "Deleting…" : "Delete"}
              </button>
            </form>
          </div>
        </div>
      </dialog>
    </>
  );
}
