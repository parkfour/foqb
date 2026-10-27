# Changelog

What changed in each release of FOQB, for the people using it. Upgrading a
self-hosted instance is covered in [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md).

## 0.8.1 (alpha) — 2026-10-27

- **Property values, side by side.** The Property values plugin now
  values each property, and the property securing each mortgage note, from
  up to three sources, each with its date:
  - FHFA's house price index: what was paid × the area's index now ÷ its
    index the quarter it was bought (metro division, metro area, state or
    US, picked from the address), with both quarters shown. Needs a free
    FRED API key.
  - RentCast's estimate from nearby sales, weekly, with its range. Needs a
    RentCast key; its free plan's 50 lookups a month are guarded by a
    monthly limit per book (40 unless changed).
  - A Zillow estimate, where the instance has a property-data API.
  Keys go in Settings → Plugins → Property values. Estimated values are
  replaced only when the book asks, with the source it picks; **Replace
  estimated values weekly** now uses the index value unless the book picks
  another, so a book that had it on for Zillow should pick Zillow again.
- **Other assets.** Properties & Assets has a list of its own for
  anything else of value (collectibles, jewelry, art, a vehicle): a name and
  a value, with what it cost and when if you like. Net worth's "Vehicles &
  Other" is now **Other Assets**, and includes them.
- **Plugin on/off is a choice, not a checkbox.** *Active* or *Off*, with
  the one in force marked "(now)"; Save lights up when anything in the card
  has changed. The old checkbox's label said what was saved, not what was
  ticked. After a save each setting now shows what was saved (a select used
  to jump back to its first option).
- **New books start with the start-up assistant on**, unless a Site Admin
  turned it off.

## 0.8.0 (alpha) — 2026-10-26

The alpha: FOQB is now largely feature complete for a small business and a
household. 0.9.0, the beta, is for cleanup.

### Business books

- **Estimates.** Quote a customer, mark it accepted or declined, and turn
  it into an invoice in one step. Nothing is booked until it's an invoice.
- **Credit memos.** Give credit back to a customer, applied to one of
  their open invoices or held until it is.
- **Void a paid invoice or bill.** Its payments are undone too, and their
  bank transactions go back to the feed to match again. Reconciled entries
  and closed periods are still protected.
- **Cost of goods sold.** Give a tracked item an inventory account and a
  cost of goods sold account. Bills buy it into inventory at average cost;
  invoices move that cost to cost of goods sold and take it off the count.
- **Classes.** Tag invoices, bills and journal lines with a class (a
  department, a location), and see the **Profit & Loss by Class**.
- **Time tracking.** Log hours by customer and service, and turn a
  customer's unbilled hours into an invoice.
- **Mileage log.** Business trips at the IRS standard rate for each
  trip's date, booked as one entry when you're ready.
- **Customer statements.** A printable statement for any customer and
  period: what they owed coming in, each invoice and payment, and what's
  due.
- **Recurring invoices and bills create themselves** on their dates, in
  the book's timezone, catching up on any days missed.
- **New reports:** Statement of Cash Flows, General Ledger, Profit & Loss
  by Class, and Foreign Currency Balances.
- **Accounts in other currencies.** A bank, card or loan account can be
  kept in another currency. Lines on it carry the foreign amount and the
  rate; **Foreign Currency Balances** revalues them at today's rate.

### Household

- **Investments.** Record buys and sells by symbol, set prices by hand or
  with the new **Security prices** plugin, and see each holding's value,
  cost and gain. Net worth counts holdings at market value.
- **Envelope budgeting.** A **To assign** figure shows income not yet
  budgeted, and one button makes every category an envelope that carries
  its balance from month to month.
- **Recurring Charges.** Subscriptions and other repeating charges, found
  in the bank feed, with what they cost a year.
- **Property values plugin (new).** Updates each property's estimated
  value weekly from a Zillow estimate, through a property-data API the
  instance subscribes to.

### Everywhere

- **Re-importing a journal entry CSV books each entry once.** Entries
  already imported are skipped and counted.
- **A bank's correction to a transaction is applied by itself** when it's
  a plain categorized one; anything else is still held for you.
- **The email-invoices plugin sends overdue reminders**, a set number of
  days apart.

### Plugins that need a tax professional

- **Payroll (US) and EU VAT (new).** Both carry a large disclaimer and do
  nothing until a Site Admin acknowledges it for the instance and each
  book's owner acknowledges it for their book. A new version of the
  disclaimer asks again.
- **Payroll** withholds federal income tax from the IRS Publication 15-T
  tables (2026), Social Security, Medicare and FUTA, and state and local
  tax at flat rates you enter; posts one entry per paycheck; and drafts the
  figures for Forms 941, 940 and W-2. It files and pays nothing.
- **EU VAT** keeps your country's rates as tax rates, marks reverse-charge
  customers, and totals output and input VAT for a period. It files
  nothing and doesn't handle OSS or each country's return boxes.

### For plugin authors

- **Ten new events:** invoices and bills voided, estimates created and
  accepted, declined or invoiced, credit memos, customers and vendors
  added, and, recorded by the database whatever made the change, every
  journal entry posted, every bank transaction imported, and the books
  being closed. A credit memo applied to an invoice now fires
  `invoice_payment:recorded`, as every payment should.
- **Invoice notes and checks.** A plugin can print lines at the foot of an
  invoice and its PDF, and refuse an invoice before it's saved. The EU VAT
  plugin uses both: your VAT number, the reverse-charge wording, and no VAT
  charged to a reverse-charge customer.
- **Reports** of a plugin's own, under Financial Reports (the VAT summary
  and payroll's draft forms are there now).
- **Slots on estimates and customer statements**, which the email plugin
  uses to email them.
- **Shared mail, bank feeds and sales tax lookup.** A plugin can send mail
  as the book through whichever plugin has a mail server, bring in a bank
  feed FOQB doesn't build in (GoCardless, say), or look up sales tax rates
  by address under Settings → Sales tax.
- **Webhooks** can subscribe to all of these events.

### Fixes

- **Webhooks respect the book's switch.** A book with the Webhooks plugin
  turned off now sends nothing, even to webhooks it set up earlier.
  Previously they kept receiving events.
- Accounts in another currency are no longer offered in forms that can't
  record a foreign amount (bills, payments, items, credit memos and
  others), where choosing one failed.
- Updating investment prices is for owners and accountants, and a price
  that couldn't be saved is reported.

### Not yet (planned for 0.9.0)

- Unapplied credit memos lower Accounts Receivable but aren't in AR Aging
  or on statements.
- Voiding a bill doesn't undo its change to an item's average cost.
- Bank feeds on accounts in another currency aren't converted.
- Net worth history doesn't include investment gains; today's figure does.

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
