# FOQB — Free, Open, Quality Bookkeeping

A multi-tenant, double-entry accounting PWA built on Next.js and Supabase. Free
to run yourself, open source (AGPL-3.0), no per-seat pricing.

Try it at <https://foqb.parkfour.com>, a public demo that's erased every 6
hours.

![Dashboard: cash, income, expenses and unreviewed bank transactions](docs/screenshots/dashboard.jpg)

| Bank feed | Profit and loss |
|---|---|
| ![Bank transactions imported through Plaid, waiting to be categorized](docs/screenshots/bank-feed.jpg) | ![Income statement by account](docs/screenshots/profit-and-loss.jpg) |
| **Receivables aging** | |
| ![Accounts receivable aging by customer and bucket](docs/screenshots/ar-aging.jpg) | |

## How it compares

Feature comparison against Wave's free Starter plan and QuickBooks Online's
cheapest true double-entry plan (Simple Start, $38/mo — QBO's $20/mo
Solopreneur tier is single-entry with no balance sheet, so it isn't a fair
comparison for a general-ledger product like this).

| Feature | **FOQB** | Wave (free) | QBO Simple Start ($38/mo) |
|---|---|---|---|
| Double-entry accounting | ✅ | ✅ | ✅ |
| Chart of accounts / journal entries | ✅ | ✅ (basic) | ✅ |
| Bank connection (live feed) | ✅ (Plaid) | ❌ — moved to paid Pro ($19/mo) | ✅ |
| Bank reconciliation | ✅ | not detailed/limited | ✅ |
| Auto-categorization rules | ✅ | ❌ (Pro only) | ✅ |
| Invoicing | ✅ (multi-line, sales tax) | ✅ | ✅ |
| Emailing invoices to customers | ✅ (plugin, through your own mail server) | ✅ | ✅ |
| Recurring invoices/bills | ✅ | ❌ | ❌ (Essentials+) |
| Bill entry / accounts payable | ✅ (full AP workflow) | ❌ | ✅ |
| Partial payments (AR/AP) | ✅ | not detailed | ✅ |
| Reports: P&L, Balance Sheet, Trial Balance | ✅ all three | "basic reporting" only | ✅ P&L; TB unclear |
| AR/AP aging reports | ✅ | ❌ | unclear/likely Essentials |
| Fixed assets + depreciation | ✅ | ❌ | ❌ (Advanced tier only) |
| Inventory tracking | ✅ (basic) | ❌ | ❌ (Plus/Advanced only) |
| Audit log | ✅ | ❌ | not advertised at this tier |
| Multi-user / roles | ✅ (owner/accountant/viewer) | ❌ single user (Pro adds users) | ❌ 1 user |
| File attachments (receipts) | ❌ — not built | ❌ (Pro only) | ✅ |
| CSV import/export | ✅ | limited | ✅ |
| Offline support (PWA) | ✅ | ❌ | ❌ |
| Multi-currency | partial (one currency per book, no conversion) | ❌ | ❌ (Essentials+) |
| Mileage / time tracking / 1099s | ❌ | ❌ | ✅ |
| Online payment collection | ❌ | ✅ (2.9%+$0.60/txn) | ✅ |
| Self-hosted / open source | ✅ | ❌ | ❌ |
| Cost | $0 (your infra) | $0 | $38/mo |

The biggest current gap versus both competitors is **file attachments**: the
receipt-scanning plugin fills in a bill from a photo, but the photo isn't
kept with it. Online payment collection isn't built either, and currency is
per book: a book can be kept in KRW or JPY, but one book can't hold accounts
in several currencies or convert between them.

## Households

An organization can also be a **household**: the same ledger and bank feed,
with a net worth page whose every figure opens what's behind it, a
checkbook-style register with split transactions, a monthly budget, a list
of properties you value yourself, and accounts tagged with Form 1040 lines
(Schedule E per rental). Run your
business and your family finances side by side and switch between them from
the header. See [docs/HOUSEHOLD.md](docs/HOUSEHOLD.md).

![Household net worth: accounts and the house by kind, with its history](docs/screenshots/household-net-worth.jpg)

**Investments aren't imported.** Brokerage and retirement accounts count
through their ledger balances, but FOQB doesn't pull in holdings, prices or
cost basis. Doing that through Plaid needs its separate Investments product,
which your Plaid account has to be approved (and billed) for. HOUSEHOLD.md
lists what adding it would take. Property values are likewise entered by
hand; there's no automatic valuation.

## Plugins

Six optional plugins ship with FOQB, each off until the operator turns it
on with `FOQB_PLUGINS`:

- **Email invoices**: send the invoice PDF to the customer through the
  organization's own mail server.
- **Webhooks**: a signed message to your URL when invoices, bills and
  payments are recorded, for Zapier, Slack or your own code.
- **Receipt scanning**: fill in a bill from a photo or PDF of the receipt,
  read on the device; nothing is uploaded.
- **Statement import**: read a bank or card statement PDF (scans too) on the
  device, book what the feed doesn't have, and reconcile the month.
- **Mortgage notes**: for mortgages you hold, split each borrower's payment
  into interest, escrow and principal, and fill in Form 1098.
- **Start-up assistant**: book what came before each account's
  opening balance to equity, then start a household budget from average spending.

| Email invoices | Receipt scanning |
|---|---|
| ![Emailing an invoice to the customer with the PDF attached](docs/screenshots/plugin-email-invoice.jpg) | ![A bill filled in from a photo of a receipt](docs/screenshots/plugin-receipt-scan.jpg) |

See [docs/PLUGINS.md](docs/PLUGINS.md), which also covers writing your own,
including private ones kept in a repository of your own.

## Tech stack

- [Next.js](https://nextjs.org) (App Router, Server Actions)
- [Supabase](https://supabase.com) — Postgres, Auth, and Row Level Security
  do all the multi-tenant data isolation and read/write role enforcement
- Tailwind CSS
- [Vitest](https://vitest.dev) for unit, component, and DB integration tests
- PWA with offline journal-entry queuing (syncs when back online)

## Quick start

You need a machine with Docker installed:

1. **Run the quickstart script.** In a terminal, run:

   ```bash
   git clone https://github.com/parkfour/foqb.git && cd foqb
   ./quickstart.sh
   ```

   It automatically writes `docker/.env` with freshly generated secrets, starts the full local stack (Next.js app, Supabase Postgres, GoTrue auth, PostgREST, and Caddy proxy) via Docker Compose, applies all database migrations, and opens your browser.

2. **Open it.** Go to **[http://localhost:8090](http://localhost:8090)** in your browser.

3. **Sign up.** Create your account. The first account created on a fresh instance becomes the **Site Admin**.

4. **Create your company.** Enter your organization name — a starter chart of accounts is seeded automatically.

5. **Manage the instance:**
   - Stop: `./quickstart.sh down`
   - Logs: `./quickstart.sh logs`
   - Status: `./quickstart.sh status`

For manual local development without Docker, running tests, or building from source, see **[docs/development.md](docs/development.md)**.

## Documentation

| Guide | For |
|---|---|
| [Developing FOQB](docs/development.md) | Manual local development (Node.js, local/hosted Supabase), running tests, and building |
| [The bank feed](docs/BANK_FEED.md) | Bank history, updates, editing, transfers between your own accounts, reconciling, starting the books from statements |
| [Households](docs/HOUSEHOLD.md) | Net worth, register and split transactions, budget, properties, journal entries, tax lines |
| [Book timezones](docs/TIMEZONES.md) | What "today" means for each organization, and changing it |
| [Book currency](docs/CURRENCY.md) | Each organization's currency, and why it's fixed once anything is booked |
| [Self-hosting](docs/SELF_HOSTING.md) | Running in production: Docker, Vercel + Supabase, reverse proxy, CI/CD, backups, and Plaid keys |
| [Security procedures](docs/SECURITY_PROCEDURES.md) | Operational security, access controls, vulnerability response, and incident handling |
| [Data retention policy](docs/DATA_RETENTION_POLICY.md) | Data lifecycles, backup schedules, and deletion rules |
| [Plugins](docs/PLUGINS.md) | Extending FOQB: server events, UI slots, categorizers, and the plugins: emailing invoices, webhooks, receipt scanning, statement import, mortgage notes, a start-up assistant |

## License

Copyright (C) 2026 Park Four, LLC

FOQB is free software: you can redistribute it and/or modify it under the
terms of the GNU Affero General Public License as published by the Free
Software Foundation, either version 3 of the License, or (at your option)
any later version. See [LICENSE](LICENSE) for the full text.

The AGPL's distinguishing term versus the plain GPL: if you run a modified
version of FOQB as a network service (e.g. you host it for other people),
you must make your modified source available to those users — running it
yourself, unmodified or modified, incurs no obligation.
