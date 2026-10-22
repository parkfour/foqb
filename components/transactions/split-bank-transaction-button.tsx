"use client";

import { useState } from "react";
import { SplitTransactionModal, type SplitTransactionModalProps } from "./split-transaction-modal";
import { splitBankTransactionAction } from "@/app/(dashboard)/transactions/actions";

// Bank Transactions' Split: the register's split modal for one row.
export function SplitBankTransactionButton({
  transaction,
  accounts,
}: Pick<SplitTransactionModalProps, "accounts"> & {
  transaction: NonNullable<SplitTransactionModalProps["transaction"]>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm text-slate-400 hover:text-slate-900"
      >
        Split
      </button>
      <SplitTransactionModal
        isOpen={open}
        onClose={() => setOpen(false)}
        transaction={transaction}
        accounts={accounts}
        onSave={async (splits) => {
          const result = await splitBankTransactionAction(transaction.id, splits);
          if (!result.success) throw new Error(result.error ?? "Couldn't save the split");
        }}
      />
    </>
  );
}
