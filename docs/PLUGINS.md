# Plugins

FOQB has a small, in-repo plugin system: **events** a plugin can react to on
the server, **slots** where a plugin can put its own controls in the UI, and
**pages** of its own in the menu.
Eight plugins ship with FOQB. An instance runs them all, and each book's
owner turns on the ones the book uses:
[email invoices](#email-invoices), [webhooks](#webhooks),
[receipt scanning](#receipt-scanning),
[statement import](#statement-import),
[mortgage notes](#mortgage-notes), [exchange rates](#exchange-rates),
[Stripe payments](#stripe-payments) and the
[start-up assistant](#start-up-assistant).

Plugins live in this repository (`plugins/<id>/`), or in a private repo of
your own (see [Private plugins](#private-plugins)), and are compiled in
with the app. There's no runtime loading of third-party code, on purpose: a
plugin runs with the signed-in user's access to their books.

## Turning plugins on

`FOQB_PLUGINS` in the app's environment says which plugins the instance
runs:

| `FOQB_PLUGINS` | Runs |
|---|---|
| unset or `*` | every plugin, including [private ones](#private-plugins) |
| `none` | nothing |
| `email-invoices,webhooks,stripe-payments` | exactly those |

Then, in the app, three layers decide where each one runs:

1. **`FOQB_PLUGINS`**, above: what the instance may run. Leave it unset
   and decide the rest in the app, or list plugins to keep the others out
   of the instance altogether.
2. **Site Admin → Plugins**, per plugin: *Off* hides it in every book and
   stops its server work (event handlers, jobs, categorizers, exchange
   rates); *Books choose* (the default) leaves it off in a book until the
   book's owner turns it on; *On for every book* starts it on, and an owner
   can still turn it off.
3. **A book's Settings → Plugins**: its owner's choice, kept once made.
   It hides or shows the plugin's slots, pages and menu links in that
   book. Server work that isn't tied to a book's own data (webhook
   delivery, statement readers) runs for every book unless the site turns
   the plugin off. A plugin may also list `settings` (text,
select, multiselect, boolean or number) for owners to set per book, read
with `getPluginSettings`. Every member of the book can read them, so they
hold choices, never secrets.

## Writing one

```ts
// plugins/hello/index.ts
import type { FOQBPlugin } from "@/lib/plugins/types";
import { HelloButton } from "./hello-button";

export const helloPlugin: FOQBPlugin = {
  manifest: { id: "hello", name: "Hello", version: "0.1.0", description: "Says hello." },
  hooks: {
    "invoice:created": async ({ invoiceNumber, orgId }) => {
      console.log(`Invoice ${invoiceNumber} created in ${orgId}`);
    },
  },
  slots: { "invoice.actions": HelloButton },
};
```

Add it to `builtInPlugins` in `plugins/index.ts` (a private one registers
itself, below), and to `FOQB_PLUGINS`.

A plugin's `index.ts` is imported by both the server and the browser (for
its slots), so it must not import anything server-only (secrets, the
service-role client, outgoing requests). Two places for that:

- **Actions** the plugin's components call: a `"use server"` file. Anyone
  signed in can call a server action, so each one checks who's asking.
- **Event handlers, background jobs and categorizers** that use secrets
  or the network: `ServerPluginParts`, listed by plugin id in
  `plugins/server.ts`, which only the server loads. A categorizer gets the
  first look at each new bank transaction (from the feed or a statement
  import), before the book's rules, and returns true if it booked it. A job (`{ name, minIntervalSeconds, run }`) runs off
  real traffic like FOQB's own maintenance (see
  [SELF_HOSTING.md](SELF_HOSTING.md)): at most once per interval, and only
  while someone is using the app.

### Server parts

`ServerPluginParts` (in `plugins/server.ts`) can hold:

| Part | What it does | Asked |
|---|---|---|
| `hooks` | [event](#events) handlers | instance-wide: check the book yourself |
| `jobs` | `{ name, minIntervalSeconds, run }` background work | instance-wide |
| `categorizers` | first look at each new bank transaction; true if it booked it | instance-wide |
| `exchangeRates`, `securityPrices` | quotes for other books' currencies and for holdings | instance-wide |
| `invoiceNotes` | lines printed at the foot of an invoice and its PDF (a VAT number, "Reverse charge", payment details) | only in books it's on in |
| `invoiceChecks` | asked before every invoice is saved, by every path; a message refuses it | only in books it's on in |
| `mailer` | sends mail as the book (`ready`, `send`); FOQB and other plugins use it through `sendBookMail` | only in books it's on in |
| `bankFeed` | a bank feed FOQB doesn't build in: `{ name, minIntervalSeconds, fetch(orgId) }` | only in books it's on in |
| `salesTaxLookup` | `{ name, rates(address) }`: rates for an address, offered under Settings → Sales tax | only in books it's on in |

"Only in books it's on in" means the site's switch, the book's, and any
acknowledgement the plugin needs: the helpers in
`lib/plugins/server-loader.ts` (`invoiceNotes`, `checkInvoice`,
`sendBookMail`, `bookCanSendMail`, `salesTaxLookups`) do that check, and a
part that throws is logged and passed over (a failing check lets the
invoice through).

**Bank feeds.** The plugin keeps each book's connection itself (encrypted,
in `plugin_data`) and offers the way to connect, in its settings or a page.
`fetch` returns the bank's accounts, each with an `id`, `name`, `kind`
(`asset` or `liability`), optional `mask` and `balance`, and its recent
`transactions` (`id`, `date`, `name`, `amount`, negative for money out).
FOQB adds a ledger account for each new bank account, skips transactions it
already has, books the rest through the categorizers and the book's rules
like any feed, records the balances, and pairs transfers. It runs as a job
named `<plugin id>-bank-feed`, and only where the book allows connecting
banks.

### Plugins that need acknowledging

A plugin whose results someone could rely on for taxes (payroll, VAT)
declares `manifest.acknowledgement`: a version, a title and the disclaimer's
paragraphs. It stays off in every book, whatever the book's switch says,
until a Site Admin acknowledges that version for the instance (Site Admin)
and then an owner for the book (Settings → Plugins). Both see the
disclaimer in full; each acknowledgement records who and when
(`plugin_acknowledgements`), and changing the version asks again. Pages
and slots follow the book's enabled list, so they're covered; a gated
plugin's own hooks and jobs run instance-wide and must check
`getOrgEnabledPluginIds` for the book themselves; the book-scoped server
parts above are checked for it.

### Private plugins

A plugin that shouldn't be public (your own tax worksheets, say) lives in a
repo of your own, checked out as `plugins/local/`, which this repo ignores.
Each folder there is a plugin: its `index.ts` (or `.tsx`) exports `plugin`,
and an optional `server.ts` exports `server` (its `ServerPluginParts`).
`scripts/local-plugins.mjs` registers them after `npm install` and before
every build and dev server, and they're turned on like any other.
A private plugin can't reuse a shipped plugin's id.

```
plugins/local/            # git clone <your repo> plugins/local
  tax-forms/
    index.ts              # export const plugin: FOQBPlugin = { ... }
    server.ts             # export const server: ServerPluginParts = { ... }
```

- **Same trust as FOQB's own code.** It's built into your instance, by
  you; nothing is loaded at runtime. Review it as you would a change to
  FOQB itself.
- **No migrations.** A private plugin keeps its values in `plugin_data`
  (`getPluginData` / `setPluginData` in `lib/plugins/data.ts`): JSON under
  keys of its own, per book, that the book's members can read and only its
  writers can change. They're in the book's backup.
- **Deploying.** The CI deploy job clones `paul/foqb-private` into
  `plugins/local` when the `FOQB_PRIVATE_DEPLOY_KEY` secret holds the
  private half of a read-only deploy key on that repo (a key that reads
  that one repo, unlike a user's access token); `vercel deploy` uploads the
  folder (it doesn't follow `.gitignore`). On another host, clone your repo
  there before building.
- **License.** FOQB is AGPL: if people other than you use an instance
  running a private plugin, they're entitled to its source.

### Events

Emitted on the server after the change is saved, by every path that makes
it (the recurring generators, estimates turned into invoices, and CSV
imports included). All handlers run together; one that throws, or takes
longer than 5 seconds, is logged and skipped, and never fails the request.
Queue anything slow. Each payload also has `orgId`.

| Event | When | Payload |
|---|---|---|
| `invoice:created` | an invoice is posted | `invoiceId`, `invoiceNumber`, `customerId`, `total` |
| `invoice:voided` | an invoice is voided, with its payments | `invoiceId`, `invoiceNumber` |
| `invoice_payment:recorded` | a payment (possibly partial) is applied, a credit memo included | `paymentId`, `invoiceId`, `invoiceStatus` |
| `credit_memo:created` | a credit memo is posted (applied or held) | `creditMemoId`, `memoNumber`, `customerId`, `total`, `appliedToInvoiceId` |
| `estimate:created` | an estimate is saved | `estimateId`, `estimateNumber`, `customerId`, `subtotal` |
| `estimate:status_changed` | accepted, declined, reopened, or invoiced | `estimateId`, `estimateNumber`, `status`, `invoiceId` |
| `customer:created` | a customer is added (form or CSV) | `customerId`, `name`, `email` |
| `bill:created` | a bill is posted | `billId`, `billNumber`, `vendorId`, `total` |
| `bill:voided` | a bill is voided, with its payments | `billId`, `billNumber` |
| `bill_payment:recorded` | a payment (possibly partial) is applied | `paymentId`, `billId`, `billStatus` |
| `vendor:created` | a vendor is added (form or CSV) | `vendorId`, `name`, `email` |
| `journal_entry:posted` | any entry becomes posted | `journalEntryId`, `entryDate`, `memo` |
| `bank_transaction:imported` | a bank row is added (feed, statement or CSV) | `bankTransactionId`, `accountId`, `date`, `name`, `amount` (negative is money out) |
| `period:locked` | the period lock date changes | `lockDate` (null: unlocked), `previousLockDate` |

The last three can be caused by database functions as well as pages, so
the database records them (`plugin_events`, a trigger on each table) and a
background job hands them to the handlers in order, usually within a
minute or two while the app is in use. One lost to a server stopping
mid-delivery isn't retried. Restoring a backup records none.

### Slots

| Slot | Where | Context |
|---|---|---|
| `invoice.actions` | beside "Download / Share PDF" on an invoice | `invoiceId`, `invoiceNumber`, `customer` (`name`, `email`), `total`, `remaining`, `dueDate`, `status`, `buildPdf()` (the same PDF the button makes) |
| `settings.sections` | the plugin's own settings, in its card under Settings → Plugins | `organizationId` |
| `dashboard.sections` | below the dashboard's own figures, household or business | `organizationId`, `workspaceType`, `canWrite` |
| `properties.sections` | a section of its own on Properties & Assets | `organizationId`, `canWrite` |
| `reconcile.header` | at the top of the Reconcile page, for writers | `accounts` (`id`, `name`, `account_number`, `type`) |
| `bill.header` | above the Enter Bill form | `vendors`, `accounts`, `prefill(bill)`: fills in any of `vendorId`, `billNumber`, `billDate`, `lines` |
| `estimate.actions` | beside an estimate's status | `estimateId`, `estimateNumber`, `customer` (`name`, `email`), `subtotal`, `status` |
| `statement.actions` | beside "Print or save as PDF" on a customer statement | `customerId`, `customer` (`name`, `email`), `start`, `end`, `amountDue` |

A slot with no plugin in it renders nothing.

### Pages

A plugin can have pages of its own: each entry in `pages` (`slug`,
`title`, optional `description`, optional `workspace: "business" |
"household"`, and `component`) is served at `/plugins/<plugin id>/<slug>`
and listed in the menu, before Settings, while the plugin is enabled and
the book is the right kind. The component renders in the browser and gets
`context`: `organizationId`, `workspaceType`, `canWrite`, and `books` (every
book the signed-in user belongs to: `id`, `name`, `workspaceType`,
`currency`), for a page that reads across books. Every read goes through
that book's own access rules, and each book's amounts are in its own
currency (see [CURRENCY.md](CURRENCY.md)); a page that adds books together
converts them itself.

### Reports

Each entry in `reports` (`id`, `title`, `range`, optional `workspace`, and
`component`) is listed under Financial Reports, in a "From plugins" group,
while the plugin is on in the book. A `range` report gets a start and end
date, otherwise an as-of date; the component renders in the browser with
`context`: `organizationId`, `start`, `end`, `asOf`. The VAT summary and
payroll's draft forms are reports this way.

## Email invoices

Plugin id `email-invoices`. Adds an **Email invoice** button to each
invoice, which sends the customer the invoice PDF, **Email estimate** and
**Email statement** buttons (the figures as text, below your message), and
an **Email** section to its card in Settings → Plugins. Its mail server is
also the book's `mailer`, for FOQB and other plugins.

![Emailing an invoice: recipient, subject and message, with the PDF attached](screenshots/plugin-email-invoice.jpg)

![Settings: the organization's mail server, saved and tested](screenshots/plugin-email-settings.jpg)

- **Each organization uses its own mail server.** An owner enters its SMTP
  server, port, user name, password, the address mail is sent from, and an
  optional reply-to address, then can send themselves a test. Mail goes out
  as "Organization Name <send-from address>". The password is encrypted with
  `ENCRYPTION_KEY` and no signed-in user can read it back, owners included.
- **Always encrypted.** Port 465 uses TLS from the start; any other port
  (usually 587) must offer STARTTLS, or nothing is sent.
- **Who can send:** owners and accountants. The server looks the invoice up
  with the sender's own access; the browser supplies only the recipient
  (prefilled with the customer's email), subject, message and the PDF it
  rendered. Void invoices can't be sent.
- **Limits:** 50 emails per organization per hour, and 5 test messages.
- **Record:** each email sent is recorded with who sent it, to whom and when;
  it shows in the Audit Log and as "Last sent" in the email dialog. Neither
  the mail server settings nor this record are in the organization backup.
- **Private networks:** the app refuses mail servers on private or local
  addresses, so owners can't use it to reach internal services. On a
  self-hosted instance whose users you trust, with a mail server on your
  LAN, set `ALLOW_PRIVATE_NETWORK_HOSTS=true`.

## Webhooks

Plugin id `webhooks`. Adds a **Webhooks** section to its card in Settings → Plugins, for
owners: each webhook is an `https` URL and the events it wants (any of the
[events](#events); "any journal entry posted" and "any bank transaction
imported" start unticked, since they're busy). On each event, FOQB POSTs:

```json
{
  "id": "delivery id",
  "event": "invoice:created",
  "created_at": "2026-10-17T21:14:03.120Z",
  "organization_id": "…",
  "data": { "invoiceId": "…", "invoiceNumber": "INV-1001", "customerId": "…", "total": 558 }
}
```

with headers `X-FOQB-Event`, `X-FOQB-Delivery` (the same id, for spotting
repeats), `X-FOQB-Timestamp` (Unix seconds) and `X-FOQB-Signature`.
"Send test" posts a `ping` event.

**Checking the signature.** Each webhook has its own secret, shown once when
it's added. The signature is an HMAC-SHA256, keyed with the secret, of the
timestamp, a dot, and the raw body:

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function isFromFoqb(rawBody, headers, secret) {
  const timestamp = headers["x-foqb-timestamp"];
  const expected = "sha256=" + createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const given = headers["x-foqb-signature"] ?? "";
  const fresh = Math.abs(Date.now() / 1000 - Number(timestamp)) < 300; // refuse replays
  return fresh && given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}
```

**Delivery.** Messages are queued, and sent once the request that caused
the event has finished, so a slow receiver never slows anyone down. A
receiver has 10 seconds to answer with a 2xx; redirects aren't followed.
Anything else is retried after 1, 5, 30, 120 and 720 minutes, then marked
failed. Retries run while the app is in use, so on a quiet instance they can
be late. Settings shows the last 20 deliveries; records are kept 30 days.

![Settings: two webhooks, and recent deliveries including a failure waiting to be retried](screenshots/plugin-webhooks.jpg)

**Safety.** URLs must be `https` and reach a public address, checked when
the webhook is added and again on every delivery
(`ALLOW_PRIVATE_NETWORK_HOSTS=true` lifts this, as for email). An
organization can have up to 10 webhooks. Secrets are encrypted with
`ENCRYPTION_KEY`, and no signed-in user can read them back.

## Receipt scanning

Plugin id `receipt-ocr`. Adds a drop zone above the Enter Bill form:
drop a photo or PDF of a receipt (or, on a phone, take one), and the form
fills in what could be read. Nothing is entered until the person clicks Enter Bill,
and then the receipt is kept with the bill as an attachment, opened from
the bill's number in Bills.

![A bill filled in from a photo of a receipt, with what was found listed above it](screenshots/plugin-receipt-scan.jpg)

- **Read on the device.** A PDF with text is read directly
  ([pdf.js](https://mozilla.github.io/pdf.js/)); a photo or a scanned PDF
  goes through [Tesseract](https://tesseract.projectnaptha.com) in the
  browser. Reading it sends nothing anywhere; when the bill is saved, the
  receipt is attached to it (below). The OCR engine and its English
  model (about 10 MB, downloaded on the first scan and then cached) are
  served by the app from `/ocr`; `npm run build` and `npm run dev` copy them
  there from `node_modules` (`scripts/copy-ocr-assets.mjs`), so no CDN is
  involved.
- **Fills in only what it found:** the vendor, when exactly one of the
  organization's vendors is named at the top of the receipt (otherwise it
  shows the name it saw and the person picks); the date; the receipt number
  as the bill number; and the lines. Line items are copied only when they,
  plus tax, add up to the total; otherwise there's one line for the total.
  Accounts are always left for the person to choose.
- **Shows its work:** a list of what was filled in and what wasn't, the text
  it read, and Tesseract's confidence, with a warning below 70%.
- **Limits:** English, US-style amounts and dates (`12.34`, `10/14/2026`),
  and the first page of a PDF. The parser (`plugins/receipt-ocr/parse.ts`)
  is a plain function with tests, the place to add other formats.

## Statement import

Plugin id `statement-import`. Adds "Import a Statement" to the Reconcile
page: choose a bank or card statement PDF, check what was read, pick the
account (one named with the statement's last four digits is picked for
you; when there's none, a new account named for the statement is offered,
and created on import), and import. An account, linked or not, opens at its earliest imported
statement's opening balance.

- **Read on the device**, with [pdf.js](https://mozilla.github.io/pdf.js/),
  like receipt scanning; the PDF isn't uploaded, only the transactions read
  from it are sent to import. Scans are read with OCR (below).
- **Checked before anything is booked:** the opening balance plus the
  transactions read must come to the statement's closing balance, to the
  cent, in the browser and again on the server. A statement that doesn't
  add up is refused. When no reader knows a layout, or what was read
  doesn't add up, the importer says why (naming any of the period, account
  number or balances it couldn't find), and "Inspect document structure" shows the lines read with
  the dates, amounts, balances and account number found in them, to help
  write a reader for it (below). Nothing is imported from there.
- **No duplicates:** a statement transaction that's already in the
  register (the same amount, dated up to 3 days apart, as the bank feed
  sometimes dates things differently) is skipped, and importing the same
  statement twice adds nothing the second time. A statement for an
  account already reconciled through its end is refused: its money is in
  the books, even if a reader now reads it into different rows.
- **Booked like the bank feed:** new transactions go through the
  categorization rules and transfer matching, and the account's opening
  balance moves earlier if the statement goes back further than the feed.
- **Reconciled when the books allow:** the import starts a reconciliation
  for the statement's date and closing balance, and completes it when
  everything on the account up to that date adds up to it. Until then it
  stays in progress: categorize the rest in the register, then import the
  statement again (or finish it on the reconciliation page). One waiting
  only on transfers is finished when the other account's statement brings
  their other side.
- **Settling earlier history** (a checkbox, off unless ticked): for an
  account whose feed goes back before the statement, "Everything before
  this statement is settled" closes that history at the statement's
  opening balance. Transactions from before it that are still to
  categorize are ignored (restorable from the register); those already
  booked keep their entries, with one adjustment against equity for any
  difference; and it all clears in a reconciliation dated the day before
  the statement.
- **Layouts:** Capital One 360 (several accounts in one statement), and
  Bank of America checking, savings and credit cards. Any other bank gets
  a best guess (`parseGeneric`): rows that start with a date and carry an
  amount, between the balances its labels name ("Beginning balance", "New
  balance"), each amount signed as printed, by the section it's under or by
  a running balance, whichever adds up to the closing balance. A statement
  no guess balances is refused, never booked; several accounts in one PDF
  need a reader of their own (below).
- **Scans:** a page with no text (a scanned or image-only statement) is
  rendered and read with OCR on the device, using the Tesseract engine the
  app serves for receipts (`ocrLines` in `text-lines.ts`), then goes to the
  same readers. OCR slips usually show up as a statement that doesn't
  balance, which is refused. The readers
  (`plugins/statement-import/parse.ts`) are plain functions with tests.

### Adding a bank

When the best guess refuses your bank's statements, or reads them wrong,
give it a reader of its own. A reader is a plain function from the
statement's text lines to `ParsedStatement`s, and it goes in a plugin of
your own (a [private one](#private-plugins) if you'd rather not publish
which banks you use) as `statementReaders`:

```ts
import { cells, dateInPeriod, parseMoney, type ParsedStatement, type StatementReader } from "@/plugins/statement-import/parse";

function parseMyBank(lines: string[]): ParsedStatement[] {
  // Find the period, account number and opening and closing balances in
  // lines.join("\n"), then a row per transaction: date, description, and
  // amount (negative for money out, or a charge on a card).
}

export const plugin: FOQBPlugin = {
  manifest: { id: "my-bank-statements", name: "My bank's statements", version: "0.1.0", description: "…" },
  statementReaders: [{ detect: /mybank\.com|My Bank/i, read: parseMyBank }],
};
```

Turn it on alongside `statement-import`. When more than
one reader's `detect` matches, the one whose bank is named first in the
statement wins, since another bank's name can turn up later in a
transfer's description. Some tips:

- **See what the reader gets.** Each line is one printed line, its columns
  joined with `" | "` (`pageLines` in `text-lines.ts`); a scan's lines
  come from OCR the same way. Write the reader against a few real
  statements' lines, then put made-up lines of the same shape in its
  tests.
- **Use the helpers**: `parseMoney` (`1,234.56`, `-$5.00`, `.06`),
  `cells`, `monthIndex`, `isoDate`, and `dateInPeriod` for a day printed
  without its year, which puts December in the year before a January
  statement.
- **Let the balance check catch mistakes.** A reader doesn't have to be
  sure: anything that doesn't come to the closing balance to the cent is
  refused before it's booked.
- **Or fall back on the guess.** A reader can call `parseGeneric(lines,
  "My Bank")` for one of the bank's layouts that the guess already reads,
  just to name the bank.

## Mortgage notes

Plugin id `mortgage-notes`. For mortgages the book holds, the borrower
paying you. Adds "Mortgage Notes You Hold" to Properties & Assets, for
owners and accountants.

- **Each note** has the borrower's and lender's names, addresses and
  taxpayer ids (encrypted with `ENCRYPTION_KEY`, shown only as the last
  four digits, and left out of the organization backup), the property
  securing it, and its fixed terms: principal, rate, term, first payment
  date, the monthly principal and interest (worked out from the terms if
  left blank) and any monthly escrow. Adding one makes its accounts: the
  note receivable, its interest income, and escrow held. What was owed when
  the books take it up is booked as the note's opening balance (by the
  schedule, unless you enter it).
- **Payments book themselves.** A deposit whose description contains the
  text you give (the borrower's name as their bank's Zelle shows it) is
  split into the month's interest on the balance owed, then the escrow
  due, then principal; extra goes to principal. Anything else, a renter's
  Zelle for one, goes to the rules as usual. A payment dated on or before
  the note's opening balance is in that balance already, so it's left to
  the rules too: to start a note at January 1, open it on December 31 at
  what was owed after December's payment. Payments already waiting when
  the note is added are booked then, oldest first; "Book waiting
  payments" does it again (after re-opening one categorized by hand).
  "Edit" changes the terms or the opening balance and splits the booked
  payments again on them; a reconciled payment keeps the split it has.
- **Form 1098** for any year: box 1 (interest received), box 2 (principal
  owed on January 1), box 3 (origination date) and box 8 (property), plus
  principal and escrow received and paid out. Box 1 is also the borrower's
  line on your Schedule B. "Borrower's statement to print" makes their
  copy; the IRS copy is filed on the official form or electronically.
- **Limits:** fixed-rate, monthly, fully amortizing notes; one month's
  interest per payment, so a missed month isn't charged twice; no late
  fees.

## Exchange rates

Plugin id `exchange-rates`. A household's net worth lists the businesses
you own; one kept in another currency is otherwise listed but left out of
the total, as nothing converts between currencies. With this plugin it's
added at the European Central Bank's reference rate, from
[Frankfurter](https://frankfurter.dev) (no key; only the two currency
codes are sent), marked "≈" with the rate and its date.

- **Shown, never booked.** A converted amount isn't stored or recorded in
  any book, and the net worth history doesn't include it.
- **No guessing.** When there's no rate (the service is down, it doesn't
  quote the currency, or its latest rate is over a week old), the business
  is left out, as without the plugin.
- Rates are kept for six hours in each app process; a failed lookup is
  tried again after ten minutes.
- Another plugin can supply rates from somewhere else: an `exchangeRates`
  source in its server parts (`rate(from, to)`, giving `{ rate, asOf,
  source }` or null). The first enabled one with a rate is used.

## Property values

Updates each property's estimated value once a week from a Zillow estimate
(a "Zestimate"). Zillow has no public API, so the instance subscribes to a
property-data API that returns one (the unofficial Zillow APIs on RapidAPI,
for example) and names it in `PROPERTY_VALUE_API_URL` (with `{address}` in
it), `PROPERTY_VALUE_API_KEY` and, for RapidAPI, `PROPERTY_VALUE_API_HOST`.
The value is the first `zestimate` field anywhere in the reply; check your
provider returns one before relying on it.

A book turns it on with **Update property values weekly** in the plugin's
settings. Each property with a street and a zip (or city and state) has its
address sent to the provider, the longest-unvalued first, 20 a week
(free tiers allow about 100 lookups a month). The value replaces what was
entered by hand.

## Payroll (US)

**Needs acknowledging** by a Site Admin and then each book's owner before it
does anything (see "Plugins that need acknowledging"): it isn't a payroll
service, and a professional should check its setup and figures.

A business book's **Payroll** page keeps employees from their Form W-4
(2020 or later: filing status, the Step 2 box, Steps 3, 4a, 4b and 4c), the
accounts a paycheck posts to, and the state unemployment rate and wage base.
**Run payroll** previews each check, then posts one journal entry per
paycheck: wages and the employer's taxes as expenses, net pay from cash,
and every amount withheld or owed to its liability account.

- Federal income tax: IRS Publication 15-T, Worksheet 1A, with the
  percentage-method tables for automated payroll (2026 shipped; a year
  without tables refuses to run).
- Social Security 6.2% each to the year's wage base ($184,500 in 2026),
  Medicare 1.45% each plus the employee's 0.9% over $200,000, FUTA 0.6% on
  each employee's first $7,000 (the full state credit assumed).
- State and local income tax as a flat percentage of gross per employee;
  SUTA at the book's rate up to its wage base.
- Draft figures for Form 941 (per quarter), Form 940 and each W-2, from
  the paychecks whose entries are still posted.

Not handled: pre-tax deductions, tips, benefits, garnishments, more than
one state, supplemental wage rules, deposits, filing, direct deposit.
Employees, accounts and paychecks are kept in the plugin's own data
(`plugin_data`), so they're in the book's backup.

## EU VAT

**Needs acknowledging** by a Site Admin and then each book's owner before it
does anything (see "Plugins that need acknowledging").

A business book's **VAT** page keeps its VAT registration (country and
number), the output VAT (liability) and input VAT (asset) accounts, and
which customers are VAT-registered businesses in another EU country. VAT
rates are named sales tax rates crediting the output VAT account: one
button adds the country's standard rate (a table of the 27 member states'
standard rates, late 2025; check the Commission's TEDB), and reduced rates
are added by name. Invoices pick them as any sales tax rate.

Every invoice, and its PDF, ends with the book's VAT number. A
reverse-charge customer's also gives their VAT number and "Reverse charge:
VAT to be accounted for by the customer (Article 196, Council Directive
2006/112/EC)", and an invoice to them that charges VAT is refused.

The **VAT summary** for a period (on the VAT page, and under Financial
Reports) gives each rate's sales and VAT charged,
the VAT paid on purchases (what was debited to the input VAT account; book
a bill's VAT there), what's due or to reclaim, and sales to reverse-charge
customers and other sales without VAT apart.

Not handled: VIES checks, OSS, imports, reverse charge on purchases,
distance-selling thresholds, each country's return boxes, filing.

## Stripe payments

Plugin id `stripe-payments` (needs `ENCRYPTION_KEY`). Each book uses its
own Stripe account.

1. **Settings → Plugins → Stripe payments** (owner): turn it on, then paste a secret key, or a restricted key
   with write access to Prices and Payment Links, and choose the asset
   account payments go into (make one called "Stripe balance").
2. In Stripe, add a webhook endpoint for the address shown there
   (`/api/stripe/webhook/<book id>`) with the event
   `checkout.session.completed`, and paste its signing secret back in
   Settings.
3. On an invoice, **Payment link** makes a Stripe payment link for what's
   still owed. Copy it into your email (or the email-invoices message).

When the customer pays, Stripe calls the webhook; the payment is recorded
against the invoice (`record_invoice_payment`, the same as recording one by
hand) into the chosen account, dated the book's today, and the link is
turned off. A link is recorded once however often Stripe sends the event,
and a webhook not signed with the book's secret is refused.

- **Fees and payouts.** The full amount goes into the Stripe balance
  account. Book Stripe's fees from it, and match its payouts to your bank
  as transfers, when you reconcile it.
- **The amount changed?** Making a link again after a partial payment
  closes the old link and makes one for the new remaining amount.
- Keys are stored encrypted (`organization_stripe_settings`), and no
  signed-in user can read them back, owners included.

## Start-up assistant

Plugin id `startup-assistant`. For starting a book from statements and
bank feeds that reach back different distances. Each account's opening
balance already holds everything dated on or before it, so history from
before it, like another bank's old transfer to it, belongs to equity.

- **The guard.** Until the book is done, nothing can be booked to an
  account on or before its opening balance's date; the error says to book
  it to equity. It's on for a book once someone who can edit it opens
  Reconcile.
- **Clean up** (on Reconcile) moves what's already there: each such entry
  is re-booked with that line on equity, the other side (and its
  reconciliation) as it was; that account's own old feed row is set aside,
  as are its other feed rows from before it. A line already reconciled on
  that account stays: a settled history adjusted for it.
- **All done** turns the guard off for the book and hides the assistant.
  A household book is first asked whether to start a budget from its
  average spending: each expense account's spending over the whole months
  the books now cover (from the month after the earliest opening balance
  to the last finished month, both changeable; at most 36), divided by the
  number of months and rounded to whole dollars, is budgeted in each of
  those months. A month already budgeted for an account keeps its amount.
  To carry it into the current month, open that month on the Budget page
  and click Copy Last Month. A household's net worth chart starts over
  that day: the points saved while accounts were being entered are cleared.
