"use client";

import { useActionState } from "react";
import { createCustomer, updateCustomer } from "@/app/(dashboard)/customers/actions";
import type { ActionState } from "@/app/(dashboard)/actions";

interface CustomerFormProps {
  organizationId: string;
  customer?: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    billing_address: string | null;
  };
}

const initialState: ActionState = { error: null };

export function CustomerForm({ organizationId, customer }: CustomerFormProps) {
  const isEdit = Boolean(customer);
  const [state, formAction, isPending] = useActionState(
    isEdit ? updateCustomer : createCustomer,
    initialState,
  );

  return (
    <div className="mx-auto max-w-lg rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-lg font-semibold text-slate-900">
        {isEdit ? "Edit Customer" : "Add Customer"}
      </h1>
      <form action={formAction} className="mt-4 flex flex-col gap-3">
        <input type="hidden" name="organizationId" value={organizationId} />
        {isEdit && <input type="hidden" name="id" value={customer!.id} />}

        <input
          name="name"
          placeholder="Customer name"
          required
          defaultValue={customer?.name ?? ""}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          name="email"
          type="email"
          placeholder="Email (optional)"
          defaultValue={customer?.email ?? ""}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          name="phone"
          placeholder="Phone (optional)"
          defaultValue={customer?.phone ?? ""}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <textarea
          name="billingAddress"
          placeholder="Billing address (optional)"
          defaultValue={customer?.billing_address ?? ""}
          rows={3}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />

        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {isPending ? "Saving…" : isEdit ? "Save Changes" : "Add Customer"}
        </button>
      </form>
      {state.error && <p className="mt-2 text-sm text-red-600">{state.error}</p>}
    </div>
  );
}
