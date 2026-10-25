# The bank feed

How transactions get from a connected bank (through Plaid or SimpleFIN)
into the books, for business and household organizations alike.

## Getting transactions

- **History.** A newly connected bank is asked for 730 days, Plaid's maximum.
  The last few weeks arrive within seconds; older history follows over the
  next minutes to hours. Banks decide how much they give, and some give
  less.
- **More history later.** Plaid fixes the history window when a bank is
  first connected. To get more, remove the bank under Settings → Bank
  Connections, connect it again, and in the account picker choose **Use** and
  the existing account for each bank account. History the books already
  have isn't imported again: a re-sent transaction with the same account,
  date and amount takes over the existing row (`adoptRelinkedRow` in
  `lib/plaid/processor.ts`) instead of becoming a duplicate.
- **An account left out.** **Add accounts** next to a connected bank under
  Settings → Bank Connections opens Plaid's account picker for the same
  connection (it doesn't count as another one). Each account newly ticked
  gets an account in the books, and its history follows.
- **Updates.** Plaid calls the app (`PLAID_WEBHOOK_URL`) when it has new
  transactions, and the app pulls them. Plaid checks most banks a few times
  a day, so a purchase can take hours, or about a day for a card, to show
  up. Settings shows when each bank last sent an update.
- **Pending transactions aren't booked.** When one posts, Plaid removes the
  pending copy and sends the posted one under a new id; only that one is
  recorded.

## SimpleFIN

[SimpleFIN](https://www.simplefin.org) is the other way in: no approval to
apply for, about $15 a year per person, paid to SimpleFIN. Connect your
banks at a SimpleFIN Bridge, make a setup token there, and paste it under
Settings → Bank Connections → **Connect through SimpleFIN instead**.

- **What comes in.** Every account at the Bridge gets an account in the
  books, named as the bank names it. SimpleFIN doesn't say what kind an
  account is, so one with a negative balance or a card, loan or mortgage
  name is booked as a liability and the rest as assets. Check them before
  categorizing: an account's type is fixed once it has entries.
- **History.** The last 90 days, SimpleFIN's limit.
- **Updates.** SimpleFIN doesn't call back, so the app asks every 4 hours
  (the `simplefin-sync` job), about the last week each time, for
  transactions that post late. Already-recorded ones are skipped.
- **Pending transactions aren't booked**, as with Plaid.
- **Disconnecting** stops the syncing; revoke the token at the Bridge too.
  If SimpleFIN stops accepting the connection, Settings says so; connect
  again with a new token, and the same accounts are used.

The setup token names the server it's claimed from, so the app only
connects to public addresses over HTTPS (`ALLOW_PRIVATE_NETWORK_HOSTS=true`
lifts that, as for webhooks and mail servers).

## Categorizing

- **Rules** (`/rules`) categorize matching transactions as they arrive.
  A rule can be limited to one bank account, for a description that means
  different things in different accounts (investment gains in a Roth and
  in a taxable account, say). At the same priority, a rule for the account
  is tried before a rule for any account. The rest wait in Bank Transactions (`/transactions`), or in the Register
  for a household, which offers a "contains" payee rule after each one you
  categorize.
- **Opening balances.** Once the bank reports a balance, each linked
  account gets one opening balance against equity: the bank's balance less
  everything imported, dated the day before the first imported row. It
  moves earlier when older transactions arrive.
- **Changing a category.** A categorized transaction's category is a
  dropdown in the Register (Change, in Bank Transactions), even once it's
  reconciled: the entry is re-booked with only the category line moved
  and the bank side, reconciliation included, kept; the old entry is
  voided, so the change stays on the record
  (`recategorize_bank_transaction` in
  `supabase/migrations/20260101000061_recategorize.sql`). Not for a split,
  a transfer between two feeds, an invoice or bill payment, or a locked
  period (`recategorize_blocker` says which).
- **Re-opening.** "Re-open" voids a categorized transaction's entry and
  sends it back to be categorized, or split, again. That's refused once
  it's part of a bank reconciliation, an invoice or bill payment, or a
  locked period (`reopen_blocker`). An ignored transaction can be restored
  the same way.
- **Finding and fixing.** Bank Transactions lists the whole feed, newest
  first, 100 to a page, with a search on the description and filters for
  account and status, so an old row can be found and fixed like a new
  one: categorize, split, ignore, restore, re-open or change it. An
  ignored row can also be deleted for good, for a duplicate that
  shouldn't stay on record; a bank feed may send it again if the bank
  later changes it. Households have it in the menu beside the Register.
- **Transfers.** Money moving between two of your linked accounts, such as
  paying the card from checking, appears in both feeds. When the same amount
  leaves one account and arrives in another within 5 days, the row offers
  "Transfer to …" / "Transfer from …", which books one entry for both rows.
  Categorizing either side to the other account by hand does the same: the
  other side, already in the feed or arriving later, joins that entry
  instead of being booked a second time (`match_transfer_counterparts` and
  `match_booked_transfer` in
  `supabase/migrations/20260101000057_bank_feed_improvements.sql`).
  Re-opening either side re-opens both. Matched pairs are booked after
  every sync; "Book all N matched transfers" in the register books any
  still waiting.

## Reconciling

Reconcile (`/reconcile`) checks a statement against the books: pick the
account, enter the statement date and ending balance, tick what cleared,
and finish once the difference is zero. Reconciled entries can't be
re-opened.

Above it, **Bank Balances** lists each linked account's balance as the bank
last reported it, next to the books' balance today. A difference usually
means something pending at the bank, or a transaction that's missing or
booked twice. For a card or loan both figures are the amount owed.

## Starting the books from statements

The feed reaches back only as far as the bank gives (often a few months), so
to start the books at, say, January 1, fill in the months before the feed
from statement PDFs with the [statement import](PLUGINS.md#statement-import)
plugin. What works:

1. **Connect every bank first**, then import. A transfer is booked
   automatically only when both sides are in the books, so an account
   that's added later leaves its transfers to categorize by hand.
2. **Import oldest first**, one statement at a time. The first statement's
   opening balance opens the account (even a linked one: the balance
   worked out from the bank is wrong while months are missing). Until all
   the months up to the feed are in, Bank Balances shows the gap as a
   difference; it shrinks to the pending items as they fill in. If the
   feed goes back further than where you want the books to start, tick
   "Everything before this statement is settled" on that first import.
3. **Import every account on a statement.** Capital One puts several
   accounts in one PDF, and each gets its own Import button. Import them
   all, or transfers between them (Capital One's daily Autopilot savings,
   for one) stay uncategorized on the side that's in. The order doesn't
   matter: importing the second side books the transfers and finishes the
   first account's reconciliation too.
4. **Categorize what's left**, in the Register, filtered to the account.
   That's usually money to or from an account the books don't have yet,
   like a brokerage or another bank; "+ New account…" in the category list
   adds one. The payee prompt that follows turns a repeat payee into a rule.
5. **Import the statement again.** Nothing is added twice, and it
   reconciles once everything up to the statement date is booked and adds
   up to the closing balance. Then the next month.

Accounts reconcile independently: one account's month can be finished
while another on the same statement waits.

## Accounts

Accounts can be edited from the chart of accounts: name, number,
description and type. The type can only change while the account has no
transactions, because changing it later would move past amounts between the
balance sheet and the profit and loss.

## Receipts and attachments

Any journal entry can carry attachments: PDFs and photos (JPEG, PNG, WebP,
HEIC, GIF), up to 4 MB each. Open the entry (from Journal Entries, a
bill's number under Bills, or **Receipts** beside a categorized
transaction in the register) and use **+ Attach a receipt or document**.
The Enter Bill form takes them too. Owners and accountants can attach and
remove files; viewers can open them.

The type is worked out from the file itself, not its name, and nothing
else is accepted. Files are kept in the database (`attachments`), with the
same row-level security as the books, so the database backups
(`scripts/backup-db.sh`, or your host's) include them. The organization
backup from Settings doesn't yet: it's a JSON file, and attachments would
make it large.
