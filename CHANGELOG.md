# Changelog

What changed in each release of FOQB, for the people using it. Upgrading a
self-hosted instance is covered in [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md).

## 0.6.0 — 2026-10-25

### Plugins, book by book

- **Choose plugins per book.** A book's owner can turn each plugin on or off
  under **Settings → Plugins**. A plugin that's off disappears from that
  book's menus and pages.
- **Site-wide control.** A Site Admin sets each plugin under **Site Admin →
  Plugins**: *Off* (hidden in every book, and its background work stops),
  *Books choose* (off in a book until its owner turns it on) or *On for
  every book*. An instance can now list every plugin in `FOQB_PLUGINS` and
  decide the rest in the app.
- **Upgrading:** plugins now start off. After upgrading, turn on the ones
  you use, for every book in Site Admin or one book at a time in Settings.
- Plugins can offer their own settings to a book's owner.

### Net worth across currencies

- A household's net worth now lists every business you own, including one
  that keeps its books in another currency. Before, such a business was
  silently left out.
- **Exchange rates plugin (new).** With it, that business is added at the
  European Central Bank's reference rate, marked "≈" with the rate and its
  date. It's an estimate, only shown: nothing converted is recorded in any
  book. Without a rate (the plugin is off, or the rate service is down or
  out of date), the business is listed but not added, and the page says so.

### Statement import

- When a statement can't be read, the importer says exactly what it couldn't
  find (the period, account number, opening or closing balance), or by how
  much the transactions read miss the closing balance.
- **Inspect document structure** shows the lines read, with the dates,
  amounts, balances and account number found in them, to help add a reader
  for that bank's layout. Nothing is imported from there.

### Other

- The version shown at the bottom of the menu opens this changelog.

## 0.5.2 — 2026-10-22

- The register opens several times faster on large books: it reads one page
  of rows, checks what each row can do in one step, and draws 200 rows at a
  time.
- Reports and sign-in checks are faster.

## 0.5.1 — 2026-10-22

- New guide to drilling down from any figure (docs/DRILL_DOWN.md).

## 0.5.0 — 2026-10-22

- **Drill down everywhere:** a figure that's a sum opens what it adds up,
  layer by layer, down to the transaction in the register.
- **Net worth history** is worked out from the books: daily for the last six
  months, then month by month.
- **Bank Transactions** covers the whole feed, with search and filters, for
  households too; any row can be fixed however old it is.
- **Ignore** a transaction straight from the register.
- A categorization rule can be limited to one bank account.
- Switching books can land on a page in the other book.
- A Site Admin can delete a book that has a mortgage note.

## 0.4.2 — 2026-10-22

- Security updates (Next.js).

## 0.4.1 — 2026-10-22

- **Each book has a currency**, shown wherever amounts are, and fixed once
  anything is booked.
- An owner can add someone who already has a login to their book.
- Coming back after a while, a notice says how many transactions are waiting
  to be categorized.
- A household's net worth chart starts when the start-up assistant is done.
- You can change your own password under Settings.
- Statement import refuses a statement for an account already reconciled
  through it, reads PDFs in older Safari, and no longer guesses an account
  for a statement without an account number.
- Net Worth counts a 403(b), 457(b) or HSA as an investment.

## 0.4.0 — 2026-10-21

- **Plugins:** email invoices, webhooks, receipt scanning, statement import,
  mortgage notes and a start-up assistant, each off until turned on.
  Plugins can add pages, menu links, statement readers and private
  add-ons of your own.
- **Bank feed:** bank balances, editable transactions and accounts, matched
  transfers, re-linking, adding accounts to an existing connection, the full
  register history and opening balances.
- **Household books:** tag accounts with Form 1040 lines (and Schedule E
  lines per property), a Journal Entries page, a starting budget from average
  spending, and every Net Worth figure opens what's in it.
- Categories stay changeable after reconciling; Budget and Cash Flow drill
  into ledgers; each account in the Chart of Accounts opens its ledger.

## 0.3.0 — 2026-10-12

- First public release.
