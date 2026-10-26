# Changelog

What changed in each release of FOQB, for the people using it. Upgrading a
self-hosted instance is covered in [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md).

## 0.7.0 — 2026-10-25

### Business books

- **Sales tax rates.** Name each rate you collect (state, city, county),
  each with its own liability account. An invoice can carry several; each
  is rounded on its own and listed on its own line on the invoice and its
  PDF. A new **Sales Tax** report shows what's owed to each agency.
- **1099-NEC.** Mark a vendor as a contractor, and the **1099-NEC** report
  totals what you paid each one in the year, by payment date, and flags
  those over the filing threshold ($600 through 2025, $2,000 from 2026).
  Payments by card are left out, as the IRS asks.
- **Stripe payments plugin (new).** Each invoice gets a payment link the
  customer pays by card. When Stripe says it's paid, the payment is
  recorded against the invoice, once, in the account you choose. Each book
  uses its own Stripe account.

### Household

- **Budget rollover.** Mark a category **Roll over** and what's left of
  its budget carries into the next month: a sinking fund for car repairs,
  say, or the holidays.
- **Between Your Books.** One event posted to your household and a
  business at once: a business expense on a personal card, an owner's
  draw, money put into the business. Each side links to the other.
- **Suspended businesses in net worth.** One suspended before its books
  were closed (its period lock date) is no longer listed. One suspended
  after is listed greyed out, with what was booked after the close.

### Everywhere

- **Attachments.** Add receipts and documents (PDFs and photos) to any
  journal entry, bill or bank booking. The receipt-scanning plugin keeps
  the photo it read.
- **SimpleFIN bank feed.** Connect banks through a SimpleFIN Bridge
  (about $15 a year, no approval needed) as well as Plaid. Accounts and the
  last 90 days come in, then new transactions every few hours, dated in
  the book's timezone.

### Plugins

- **Every plugin is available unless the operator says otherwise.** With
  `FOQB_PLUGINS` unset, an instance runs all of them; a list still narrows
  it, and `none` still turns them all off. Site Admin and each book's owner
  choose from there, as before, so nothing turns on in a book by itself.
- A plugin's own settings (keys, mail server, webhooks) are now inside its
  card under **Settings → Plugins**, and show as soon as it's turned on.

### Fixes

- A balance that rounds to zero shows as $0.00, not -$0.00.

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
