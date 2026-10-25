"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { postBetweenBooks } from "@/app/(dashboard)/between-books/actions";
import { KINDS, type BetweenBooksKind } from "@/lib/between-books";
import { formatAccountLabel } from "@/lib/accounts/format";
import { formatMoney } from "@/lib/money";

export interface BookOption {
  id: string;
  name: string;
  currency: string;
  accounts: { id: string; account_number: string; name: string; type: string }[];
  bankTransactions: { id: string; account_id: string | null; date: string; name: string | null; amount: number }[];
}

const field = "rounded-md border border-slate-300 px-3 py-2 text-sm";
const TYPE_ORDER = ["asset", "liability", "equity", "revenue", "expense"];

function AccountSelect({ name, label, book, showAccountCodes, value, onChange }: {
  name: string;
  label: string;
  book: BookOption;
  showAccountCodes: boolean;
  value?: string;
  onChange?: (id: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm text-slate-700">
      {label}
      <select name={name} required className={field} value={value} onChange={onChange && ((e) => onChange(e.target.value))}>
        <option value="">Choose an account…</option>
        {TYPE_ORDER.map((type) => (
          <optgroup key={type} label={type[0].toUpperCase() + type.slice(1)}>
            {book.accounts
              .filter((a) => a.type === type)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {formatAccountLabel(a, showAccountCodes)}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

// One book's side: its two accounts, and optionally the bank transaction
// it already shows (which then gets this entry instead of a category).
function Side({ prefix, title, book, debitLabel, creditLabel, sign, showAccountCodes, onBank }: {
  prefix: "a" | "b";
  title: string;
  book: BookOption;
  debitLabel: string;
  creditLabel: string;
  // Money out of this side's paid-from account is negative in the feed;
  // 0 when no bank account of this side's is involved.
  sign: -1 | 0 | 1;
  showAccountCodes: boolean;
  onBank: (tx: BookOption["bankTransactions"][number] | null) => void;
}) {
  const [bankId, setBankId] = useState("");
  const [bankAccount, setBankAccount] = useState<string | undefined>(undefined);
  const candidates = sign === 0 ? [] : book.bankTransactions.filter((t) => Math.sign(Number(t.amount)) === sign && t.account_id);
  const bankSide = sign < 0 ? "credit" : "debit";

  return (
    <fieldset className="flex flex-col gap-3 rounded-lg border border-slate-200 p-4">
      <legend className="px-1 text-sm font-semibold text-slate-900">
        {title}: {book.name}
      </legend>
      <input type="hidden" name={`${prefix}Org`} value={book.id} />
      {candidates.length > 0 && (
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          Already in the bank feed? (optional)
          <select
            name={`${prefix}Bank`}
            value={bankId}
            className={field}
            onChange={(e) => {
              const tx = candidates.find((t) => t.id === e.target.value) ?? null;
              setBankId(e.target.value);
              setBankAccount(tx?.account_id ?? undefined);
              onBank(tx);
            }}
          >
            <option value="">No, nothing to match</option>
            {candidates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.date} · {t.name ?? "Transaction"} · {formatMoney(Math.abs(Number(t.amount)), book.currency)}
              </option>
            ))}
          </select>
        </label>
      )}
      <AccountSelect
        name={`${prefix}Debit`}
        label={debitLabel}
        book={book}
        showAccountCodes={showAccountCodes}
        {...(bankSide === "debit" && bankId ? { value: bankAccount, onChange: setBankAccount } : {})}
      />
      <AccountSelect
        name={`${prefix}Credit`}
        label={creditLabel}
        book={book}
        showAccountCodes={showAccountCodes}
        {...(bankSide === "credit" && bankId ? { value: bankAccount, onChange: setBankAccount } : {})}
      />
    </fieldset>
  );
}

export function BetweenBooksForm({ thisBookId, books, today, showAccountCodes }: {
  thisBookId: string;
  books: BookOption[];
  today: string;
  showAccountCodes: boolean;
}) {
  const thisBook = books.find((b) => b.id === thisBookId)!;
  const others = books.filter((b) => b.id !== thisBookId && b.currency === thisBook.currency);
  const [kind, setKind] = useState<BetweenBooksKind>("paid_for");
  const [otherId, setOtherId] = useState(others[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [result, action, pending] = useActionState(postBetweenBooks, null);
  const other = others.find((b) => b.id === otherId);
  const labels = KINDS[kind];
  const fromBank = (tx: BookOption["bankTransactions"][number] | null) => {
    if (!tx) return;
    setAmount(String(Math.abs(Number(tx.amount))));
    setDate(tx.date);
  };

  if (others.length === 0) {
    return <p className="text-sm text-slate-500">None of your other books keeps its accounts in {thisBook.currency}.</p>;
  }

  return (
    <form action={action} className="flex max-w-3xl flex-col gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <input type="hidden" name="kind" value={kind} />
      <div className="flex flex-col gap-2">
        {(Object.keys(KINDS) as BetweenBooksKind[]).map((k) => (
          <label key={k} className="flex items-start gap-2 text-sm text-slate-700">
            <input type="radio" checked={kind === k} onChange={() => setKind(k)} className="mt-1" />
            <span>
              <span className="font-medium text-slate-900">{KINDS[k].label}</span>
              <span className="block text-xs text-slate-500">{KINDS[k].hint}</span>
            </span>
          </label>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <label className="flex flex-col gap-1 text-sm text-slate-700 sm:col-span-2">
          The other book
          <select value={otherId} onChange={(e) => setOtherId(e.target.value)} className={field}>
            {others.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          Date
          <input type="date" name="date" required value={date} onChange={(e) => setDate(e.target.value)} className={field} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          Amount
          <input
            type="number"
            name="amount"
            step="0.01"
            min="0.01"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={field}
          />
        </label>
      </div>
      <input name="memo" placeholder="Memo, e.g. Printer ink for the business" maxLength={200} className={field} />

      <Side
        key={`a-${kind}`}
        prefix="a"
        title="This book"
        book={thisBook}
        debitLabel={labels.thisDebit}
        creditLabel={labels.thisCredit}
        sign={-1}
        showAccountCodes={showAccountCodes}
        onBank={fromBank}
      />
      {other && (
        <Side
          key={`b-${kind}-${other.id}`}
          prefix="b"
          title="The other book"
          book={other}
          debitLabel={labels.otherDebit}
          creditLabel={labels.otherCredit}
          sign={kind === "transfer" ? 1 : 0}
          showAccountCodes={showAccountCodes}
          onBank={fromBank}
        />
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {pending ? "Posting…" : "Post to both books"}
      </button>
      {result && "error" in result && <p className="text-sm text-red-600">{result.error}</p>}
      {result && "ok" in result && (
        <p className="text-sm text-emerald-700">
          Posted to both books.{" "}
          {result.entryId && (
            <Link href={`/journal/${result.entryId}`} className="underline">
              Open this book&rsquo;s entry
            </Link>
          )}
        </p>
      )}
    </form>
  );
}
