# Developing FOQB

This guide covers setting up a local development environment for working on FOQB's code, running tests, and building from source.

- If you just want to run a local instance quickly with Docker, see the [Quick start](../README.md#quick-start) in the root README (`./quickstart.sh`).
- For production self-hosting (Docker, Vercel + Supabase, reverse proxy, backups, and Plaid production approval), see [SELF_HOSTING.md](SELF_HOSTING.md).

---

## Tech stack

- **Frontend & Server Actions**: [Next.js](https://nextjs.org) (App Router, Server Actions)
- **Database & Auth**: [Supabase](https://supabase.com) — PostgreSQL with Row Level Security (RLS) enforcing multi-tenant data isolation and read/write role enforcement, GoTrue for Auth
- **Styling**: [Tailwind CSS](https://tailwindcss.com)
- **Testing**: [Vitest](https://vitest.dev) for unit, component, and DB integration tests
- **Offline / PWA**: PWA with offline journal-entry queuing via IndexedDB (Dexie) syncing when back online

---

## Prerequisites

- **Node.js**: 24+
- **Database**: A Supabase project — either:
  - A hosted Supabase project at [supabase.com](https://supabase.com) (recommended, matches production), or
  - The [Supabase CLI](https://supabase.com/docs/guides/cli) + Docker for a fully local database stack
- **(Optional) Plaid**: A [Plaid](https://plaid.com) developer account (only needed for live bank-feed sync; not required for core bookkeeping features)

---

## Step-by-step local setup

### 1. Install dependencies

```bash
git clone https://github.com/parkfour/foqb.git
cd foqb
npm install
```

### 2. Set up the database

Choose either Option A (hosted Supabase) or Option B (local Supabase CLI):

#### Option A — hosted Supabase project (recommended, matches production)

1. Create a project at [supabase.com](https://supabase.com).
2. Authenticate and link your repository:

```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase db push
```

This applies every migration in `supabase/migrations/` in sequence.

#### Option B — fully local stack (requires Docker)

```bash
supabase start
```

This spins up the Supabase local stack, applies all migrations in `supabase/migrations/`, and prints local API URLs and keys to your terminal.

### 3. Configure environment variables

Copy the template:

```bash
cp .env.example .env.local
```

Fill in `.env.local`:

- `NEXT_PUBLIC_SUPABASE_URL`: Your Supabase API URL (e.g. `https://<ref>.supabase.co` or `http://localhost:54321` for `supabase start`).
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: The public anon/publishable key from Supabase Project Settings → API.
- `SUPABASE_SERVICE_ROLE_KEY`: The private service role key from Project Settings → API (used by server actions for elevated operations like tenant provisioning).
- `ENCRYPTION_KEY`: A 32-byte base64 encryption key for stored credentials:
  ```bash
  openssl rand -base64 32
  ```
- `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`, `PLAID_WEBHOOK_URL`, `PLAID_REDIRECT_URI`: *(Optional)* Only needed for live bank connections. Leave blank to run without bank feeds.
- `LEGAL_OPERATOR_NAME`, `LEGAL_CONTACT_EMAIL`, `LEGAL_JURISDICTION`: *(Optional)* Operator info displayed on `/privacy`, `/terms`, and `/security`.
- `DEMO_MODE`: *(Optional)* Set to `1` to display the demo banner and disable password resets.

### 4. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

- Sign up for a new account.
- The first user account created becomes the **Site Admin**.
- Create your organization. A starter chart of accounts is seeded automatically.

---

## Sample data

Two scripts fill an empty organization with three months of believable
data, for trying things out and for screenshots:

- `scripts/seed-sample-company.sql`: a small coffee roaster (customers,
  vendors, invoices and bills, a bank feed). Use a business organization.
- `scripts/seed-sample-household.sql`: a family (paychecks, mortgage, card
  spending, a register with categorized and pending transactions, two
  properties, budgets, net worth history). Use a household organization.

Create the organization in the app first (that gives it its starter chart
of accounts), then run the script as a database owner with its id:

```bash
psql "$DATABASE_URL" -v org=<organization id> -f scripts/seed-sample-household.sql
```

## Testing

FOQB uses [Vitest](https://vitest.dev) for testing. Tests are split by scope:

```bash
npm run test             # unit tests (pure business logic and utilities)
npm run test:components  # component tests (React components with Testing Library)
npm run test:db          # database integration tests (spins up ephemeral Postgres via Docker)
npm run test:all         # runs all three test suites sequentially
npm run verify:mfa       # end-to-end 2FA verification against a real local Supabase (run `supabase start` first)
```

### Database integration tests (`npm run test:db`)

The DB tests spin up their own ephemeral PostgreSQL container using Docker, run all migrations, execute tests against real Row Level Security policies, and tear down the container when finished. A working Docker CLI is required. Beside it they start PostgREST (`postgrest/postgrest`), the API Supabase puts in front of the database, so code that talks to the database through supabase-js can be tested as a signed-in user: see `tests/db/rest.ts`.

---

## Building for production

To build and run the production Next.js build locally:

```bash
npm run build
npm start
```

---

## Docker development & building images

To test the self-contained Docker Compose stack with images built directly from your current checkout (rather than pulled from GHCR):

1. Generate secrets in `docker/.env` if not already present:
   ```bash
   docker/setup.sh http://localhost:8090
   ```
2. Clear `FOQB_APP_IMAGE` and `FOQB_MIGRATE_IMAGE` in `docker/.env`, or build explicitly:
   ```bash
   docker compose -f docker/compose.yml up -d --build
   ```
3. Stop containers when done:
   ```bash
   docker compose -f docker/compose.yml down
   ```

To reset the database and start fresh with sample data or empty state:
```bash
docker compose -f docker/compose.yml down -v
./quickstart.sh
```
