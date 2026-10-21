"use client";

import { useActionState, useRef } from "react";
import { deleteOrganization } from "@/app/(site-admin)/site-admin/actions";
import type { ActionState } from "@/app/(dashboard)/actions";

const initialState: ActionState = { error: null };

export function DeleteOrganizationDialog({
  organizationId,
  organizationName,
}: {
  organizationId: string;
  organizationName: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, formAction, isPending] = useActionState(deleteOrganization, initialState);

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
          <h2 className="text-sm font-semibold text-slate-900">
            Delete &ldquo;{organizationName}&rdquo;?
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            This permanently deletes the organization and everything in it — accounts, journal
            entries, invoices, bills, customers, vendors, all of it. This can&rsquo;t be undone.
          </p>
          {state.error && <p className="mt-3 text-xs text-red-600">{state.error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="rounded-md px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
            <form action={formAction}>
              <input type="hidden" name="id" value={organizationId} />
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
