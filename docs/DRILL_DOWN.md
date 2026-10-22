# Drilling down

Any figure FOQB gets by adding things up opens what it adds up, layer by
layer, down to the transaction. The rule of thumb: if you'd have to add
things up to get a number, you can click through to what's in it.

## The layers

| Click | Opens |
|---|---|
| An account on a report (Trial Balance, Profit & Loss, Balance Sheet, Cash Flow) | The account's report (`/reports/account/<id>`): every posted line in the period, with a running balance |
| A line of an account's report | The transaction: in the Register, if it came from the bank feed; otherwise its journal entry |
| A tax line on the Tax Line report | Its accounts (`/reports/tax-line/accounts`), each with its transactions in a section of its own |
| A figure on Net Worth | What's in it: each account (its report) and property |
| A category on Budget or Cash Flow | That category's account report for the month |
| An account in the Chart of Accounts | Its account report |
| A card on the business dashboard | The report it sums: Cash on Hand opens the Balance Sheet; Net Income and Total Expenses open the Profit & Loss for the month; Unreconciled Transactions opens Bank Transactions filtered to them |
| A recent transaction on the dashboard | That transaction in the Register |
| An invoice on the A/R Aging report | The invoice; the customer's name opens the customer |
| A bill or vendor on the A/P Aging report | The vendor, with their bills |
| A memo on Journal Entries | The entry |

## Opening a transaction in the Register

`/register?account=<account id>&tx=<bank transaction id>` loads that
account's whole history, highlights the transaction and scrolls to it.
Drill-downs link here for anything booked from the bank feed, so the
transaction can be changed where it was found: re-categorized, split,
re-opened or ignored.

## Journal entries

`/journal/<entry id>` shows one entry: its date, memo, status and lines,
each line's account opening that account's report as of the entry's date.
An entry booked from the bank feed links to its transaction in the
Register.

## Figures from another book

A plugin's figure can come from another of your books (a Schedule C from a
business book on a household's return, say). Opening it switches to that
book and lands on the page: `switchOrganization` takes a `next` path, on
this site only, as sign-in's does. The book picker then shows the book
you're in.

For plugin authors: `lib/reports/tax-line-links.ts` builds a tax line's
accounts link, and `lib/reports/entry-links.ts` turns an account's journal
entries into Register or journal-entry links.
