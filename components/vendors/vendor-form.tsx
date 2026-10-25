"use client";

import { useActionState } from "react";
import { createVendor, updateVendor } from "@/app/(dashboard)/vendors/actions";
import type { ActionState } from "@/app/(dashboard)/actions";

interface VendorFormProps {
  organizationId: string;
  vendor?: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    address: string | null;
    is_1099: boolean;
  };
}

const initialState: ActionState = { error: null };

export function VendorForm({ organizationId, vendor }: VendorFormProps) {
  const isEdit = Boolean(vendor);
  const [state, formAction, isPending] = useActionState(
    isEdit ? updateVendor : createVendor,
    initialState,
  );

  return (
    <div className="mx-auto max-w-lg rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-lg font-semibold text-slate-900">
        {isEdit ? "Edit Vendor" : "Add Vendor"}
      </h1>
      <form action={formAction} className="mt-4 flex flex-col gap-3">
        <input type="hidden" name="organizationId" value={organizationId} />
        {isEdit && <input type="hidden" name="id" value={vendor!.id} />}

        <input
          name="name"
          placeholder="Vendor name"
          required
          defaultValue={vendor?.name ?? ""}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          name="email"
          type="email"
          placeholder="Email (optional)"
          defaultValue={vendor?.email ?? ""}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          name="phone"
          placeholder="Phone (optional)"
          defaultValue={vendor?.phone ?? ""}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <textarea
          name="address"
          placeholder="Address (optional)"
          defaultValue={vendor?.address ?? ""}
          rows={3}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            name="is1099"
            defaultChecked={vendor?.is_1099 ?? false}
            className="h-4 w-4 rounded border-slate-300"
          />
          Gets a 1099-NEC (an independent contractor, not a corporation)
        </label>

        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {isPending ? "Saving…" : isEdit ? "Save Changes" : "Add Vendor"}
        </button>
      </form>
      {state.error && <p className="mt-2 text-sm text-red-600">{state.error}</p>}
    </div>
  );
}
