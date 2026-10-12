# FOQB — Free, Open, Quality Bookkeeping

A multi-tenant, double-entry accounting PWA built on Next.js and Supabase. Free
to run yourself, open source (AGPL-3.0), no per-seat pricing.

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
| Emailing invoices to customers | ❌ — not built | ✅ | ✅ |
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
| Multi-currency | ❌ | ❌ | ❌ (Essentials+) |
| Mileage / time tracking / 1099s | ❌ | ❌ | ✅ |
| Online payment collection | ❌ | ✅ (2.9%+$0.60/txn) | ✅ |
| Self-hosted / open source | ✅ | ❌ | ❌ |
| Cost | $0 (your infra) | $0 | $38/mo |

The biggest current gaps versus both competitors are **invoice emailing** (you
export/send the PDF yourself for now — no SMTP/transactional-email provider
is wired in yet) and **file attachments**. Both are deliberate v0.1.0 scope
cuts, not oversights.

## Tech stack

- [Next.js](https://nextjs.org) (App Router, Server Actions)
- [Supabase](https://supabase.com) — Postgres, Auth, and Row Level Security
  do all the multi-tenant data isolation and read/write role enforcement
- Tailwind CSS
- [Vitest](https://vitest.dev) for unit, component, and DB integration tests
- PWA with offline journal-entry queuing (syncs when back online)

## Getting started

### Prerequisites

- Node.js 24+
- A Supabase project — either a free hosted project at
  [supabase.com](https://supabase.com), or the
  [Supabase CLI](https://supabase.com/docs/guides/cli) + Docker for a fully
  local stack
- (Optional) a [Plaid](https://plaid.com) developer account, only needed for
  live bank-feed sync

### 1. Install dependencies

```bash
npm install
```

### 2. Set up the database

**Option A — hosted Supabase project (recommended, matches production):**

```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase db push
```

**Option B — fully local stack (needs Docker):**

```bash
supabase start
```

This applies every migration in `supabase/migrations/` and prints local API
URL/keys to use below.

### 3. Configure environment variables

```bash
cp .env.example .env.local
```

Fill in:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY` — from your Supabase project's
  Settings → API (or printed by `supabase start` for the local stack)
- `ENCRYPTION_KEY` — a 32-byte base64 key: `openssl rand -base64 32`
- `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`, `PLAID_WEBHOOK_URL` —
  optional, only needed for bank sync; leave blank otherwise

### 4. Run it

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), sign up, and create an
organization — a starter chart of accounts is seeded automatically.

## Testing

```bash
npm run test             # unit tests
npm run test:components  # component tests
npm run test:db          # DB integration tests — spins up its own ephemeral
                          # Postgres via Docker, needs a working Docker CLI
npm run test:all         # all three
npm run verify:mfa       # end-to-end 2FA check against a real local Supabase
                          # (run `supabase start` first); starts its own app
```

## Building

```bash
npm run build
npm start
```

## Going further

This gets you running locally. For deploying your own instance, CI/CD,
configuring the legal/security pages, restricting signup, and getting a
bank-data provider (e.g. Plaid) to approve you for production access, see
[docs/SELF_HOSTING.md](docs/SELF_HOSTING.md).

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
