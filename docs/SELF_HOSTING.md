# Self-hosting FOQB

This is the deeper guide the [README](../README.md) doesn't try to be:
running your own instance in production, wiring up CI/CD, and — if you want
live bank sync — actually getting a bank-data provider like Plaid to approve
you for production access. FOQB isn't a commercial product and there's no
hosted version to sign up for; this is the whole playbook so you can run it
yourself and get the same result.

If you just want to poke at it locally, see the [README](../README.md)'s
"Quick start" section or [development.md](development.md). Come back here once you're ready
to put a real instance on the internet.

## 1. Provision the backend

Create a [Supabase](https://supabase.com) project (the free tier is enough
to start) and apply the schema:

```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase db push
```

This runs every migration in `supabase/migrations/`.

## 2. Deploy the app

Any host that runs Next.js works; these docs assume [Vercel](https://vercel.com)
since that's what's actually been run in production. Create a project, point
it at your fork, and set these environment variables (production target):

**Required** — see `.env.example` for the full list with descriptions:
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY`, `CRON_SECRET`.

**Optional, for live bank sync**: `PLAID_CLIENT_ID`, `PLAID_SECRET`,
`PLAID_ENV`, `PLAID_WEBHOOK_URL`, `PLAID_REDIRECT_URI` (your
`https://…/settings/bank-return`, also registered in Plaid's dashboard —
needed for banks that sign in on their own site, especially on phones).
Leave these unset and the app runs fine without bank connections — Plaid is required for the "connect a bank"
feature, nothing else.

**Optional, everything else**: `LEGAL_OPERATOR_NAME` /
`LEGAL_CONTACT_EMAIL` / `LEGAL_JURISDICTION` (see §4), `SIGNUP_ALLOWLIST`
(see §5), `ALLOWED_PROXY_IP` (see §6), `SOURCE_CODE_URL` (where your users
can get your copy of the code. The AGPL requires this if you've modified it),
`DEFAULT_TIMEZONE` (an IANA name like `America/Chicago`, UTC if unset: the
timezone of any organization that hasn't chosen its own in Settings; new ones
start in their creator's browser timezone).

**Optional, plugins**: `FOQB_PLUGINS`. Unset (or `*`), the instance runs
every plugin; a comma-separated list (`email-invoices`, `webhooks`,
`receipt-ocr`, `statement-import`, `mortgage-notes`, `startup-assistant`,
`exchange-rates`, `stripe-payments`) runs just those, and `none` runs none.
A Site Admin then sets each
one to off, books choose (the default) or on for every book, and each
book's owner turns it on or off; see [PLUGINS.md](PLUGINS.md#turning-plugins-on).
`ALLOW_PRIVATE_NETWORK_HOSTS=true` lets organizations' mail servers and
webhook URLs be on private addresses; leave it unset on any instance whose
users you don't trust with your network.

## 3. Wire up CI/CD

This repo's own `.github/workflows/ci.yml` is a real, working reference. It
runs unchanged on GitHub Actions and on Gitea Actions (which reads
`.github/workflows` too). Deploying and publishing happen only on the Gitea
instance this repo is developed on; on GitHub, only the checks run. The
deploy job needs these repository secrets: `VERCEL_TOKEN`,
`VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `SUPABASE_ACCESS_TOKEN`,
`SUPABASE_PROJECT_REF` and `SUPABASE_DB_PASSWORD_PUBLIC` (the database
password). The shape:

1. **`verify` job**: `npm ci`, `npx next typegen` (Next.js needs this to
   generate route/layout prop types before `tsc` can see them on a clean
   checkout), typecheck, lint, unit tests, component tests, then DB
   integration tests (spins up its own ephemeral Postgres via Docker — the
   runner needs real Docker CLI access, not just a job container).
2. **`deploy` job** (`needs: verify`, so it never runs against unverified
   code): on `main` only, `supabase link` + `supabase db push` against your
   production project, then `vercel deploy` (`--prod` on `main`, a preview
   deploy otherwise). A plain `vercel deploy` triggers a **remote** build on
   Vercel's infrastructure — the CI runner just triggers it and waits.

Running two public-facing instances (e.g. a private one and a public one for
a third party to review) is just this same pipeline duplicated with a
second Supabase project ref and a second Vercel project ID: a second
`Run DB migrations` step pointed at the second project's ref, and a second
`Deploy production` step pointed at the second Vercel project ID. This repo
briefly ran that way for a Plaid review instance, but has since
consolidated back onto the one instance below — the CI file no longer
demonstrates the dual-deploy shape, just the pattern for adding it back.

**No scheduled task setup needed.** Vercel's Hobby plan caps cron jobs at
one per account — two instances each needing two maintenance jobs (expiring
unclaimed member accounts, cleaning up old rate-limit records) blows past
that immediately. Rather than needing a paid plan or a second scheduling
service, both jobs piggyback on real request traffic instead
(`lib/cron/piggyback.ts`, invoked from `lib/supabase/middleware.ts` via
`next/server`'s `after()` so it never adds latency to the response). Each
job atomically claims its own run (`claim_cron_run` in
`supabase/migrations/20260101000025_cron_piggyback.sql`) so concurrent
requests can't double-run it, and simply isn't due most of the time — one
cheap row check, not the actual cleanup work. The old `/api/cron/*` routes
still exist as a manual/on-demand trigger (`CRON_SECRET`-gated) if you ever
want to force a run.

## 4. Configure the legal & security pages

`/privacy`, `/terms`, and `/security` all read from `getOperatorInfo()`
(`lib/legal/operator.ts`), which returns `null` unless all three of
`LEGAL_OPERATOR_NAME`, `LEGAL_CONTACT_EMAIL`, and `LEGAL_JURISDICTION` are
set — until then, those pages show an honest "not configured" placeholder
instead of silently showing someone else's identity (e.g. this repo's own,
if you forked it without changing anything). Set all three before you send
anyone — including a bank-data provider's reviewer — to a live instance.

## 5. Restricting signup and bank connections (optional)

To close sign-ups entirely, untick **Allow sign-ups** under Site Settings
in the Site Admin console. The sign-up page and links disappear, and the
database refuses new accounts, including ones created by calling Supabase
Auth directly with the public anon key. Site Admins and organization owners
can still create accounts for people. The server gives each such account a
one-time exemption (`lib/auth/admin-create-user.ts`,
`supabase/migrations/20260101000043_site_settings_signups.sql`).
An owner adds someone who already has a login to another book with the
same form (Settings → Members): it adds that login rather than making a
new one.

**Allow connecting banks**, under the same Site Settings, turns off Plaid
Link for every organization. Each organization's owners have the same
switch for their own organization in Settings → Bank Connections. Both must
be on to connect or reconnect a bank. Existing connections keep syncing
(`supabase/migrations/20260101000044_bank_linking_switches.sql`).

To let only some people sign up, use `SIGNUP_ALLOWLIST`. It gates `app/signup/actions.ts` via
`lib/auth/signup-allowlist.ts`'s `isEmailAllowed()`. Comma-separated,
each entry either a full email (`jimmy@cheese.com`) or a `*@domain`
wildcard. Unset means open signup. Useful if you want a second, publicly
reachable instance (no client-cert gate) for a third party to review without
it being a fully open public instance — see §7.

## 6. Restricting direct access to one reverse proxy (optional)

If you put FOQB behind your own reverse proxy — for example one doing
client-certificate (mTLS) authentication before anything reaches the app —
set `ALLOWED_PROXY_IP` to that proxy's IP and `proxy.ts` will reject any
request whose `x-forwarded-for` doesn't match it, so the underlying
`*.vercel.app` URL can't be used to bypass your proxy's auth. Leave it unset
(the default) and this check is skipped entirely — most self-hosted
instances don't need it.

Because every request then arrives from the proxy's address, have the proxy
pass the real client IP in an `X-Client-IP` header so login/signup rate
limits stay per-visitor instead of one shared bucket for the whole site. It
must *set* (overwrite) the header, never append to a client-supplied one —
for Apache: `RequestHeader set X-Client-IP "%{REMOTE_ADDR}s"`.

## 7. Getting a bank-data provider to approve production access

If you want live bank sync, you'll apply for production access with
whichever provider you use (Plaid, in this codebase). This section is
Plaid-specific but the shape of the process — profile, security
questionnaire, live review — is typical of the category.

**Before you apply**, you need a live, reachable instance a reviewer can
actually open. If your primary instance is behind a client-certificate
gate (like `ALLOWED_PROXY_IP` above), stand up a second instance without
that gate — §3's dual-deploy pattern plus `SIGNUP_ALLOWLIST` restricted to
the reviewer's domain/email is exactly this. This repo used that pattern
during its own Plaid review (a second `foqb-public` instance, deployed
alongside the mTLS-gated one from the same pipeline), then decommissioned
the private instance once review was done and consolidated onto the one
that's easier to reach — `foqb-public` isn't gated at all, so it needed no
second instance to review it.

**Plaid's dashboard profile** needs: legal entity name, product name,
website, logo, support contact, and a link to your privacy policy — point
it at your `/privacy` page.

**Data Transparency Messaging.** Plaid also requires at least one "use
case" under Link → Data Transparency in the dashboard (bookkeeping fits;
personal finance management too, if you run households). It's what Link
tells people their data is used for. Without one, Plaid refuses to start
Link (`INVALID_LINK_CUSTOMIZATION` in the app's logs) and "Connect a bank"
fails, though connections made earlier keep syncing.

**Plaid's security questionnaire** covers three broad areas — governance,
technical controls, and operational practices. What's already true in this
codebase, and can be answered directly:

- Encryption in transit (TLS everywhere) and at rest (Plaid access tokens,
  and the plugins' mail server passwords and webhook secrets, are encrypted
  before storage — `lib/crypto/token-encryption.ts`).
- Webhook signature verification (`app/api/webhooks/plaid/route.ts` verifies
  Plaid's ES256 JWT signature against their published JWKS before
  processing anything).
- Per-tenant data isolation enforced at the database layer via Postgres RLS,
  not just application logic. The report functions and the register's
  checks run without it for speed and check membership themselves.
- Automated testing gate before any deploy (§3's `verify` job).
- Audit logging of account/org changes.
- Optional TOTP two-factor authentication (Settings → Two-Factor
  Authentication), backed by Supabase Auth's native MFA — no custom crypto.
- A published, honest security policy (`/security`) and privacy policy
  (`/privacy`) a reviewer can actually read, since they won't have access to
  your private repo.

What's realistically **not** true for a small or solo operation, and is
fine to answer honestly rather than invent: formal vendor management,
security-awareness training, background checks, and an independent
third-party security assessment. "Not yet, planned" is a normal answer at
this stage — none of it blocks approval, and providers don't expect a SOC 2
report from a pre-launch project. (SOC 2 itself is a sales/trust artifact
some enterprise customers demand later — budget $10–35k for it only if a
specific deal requires it, not as a prerequisite to launching.)

## 8. Database backups (Supabase free plan)

Supabase's free plan includes no backups. `scripts/backup-db.sh` makes a
nightly encrypted backup from any always-on machine with Docker and the
Supabase CLI. `scripts/restore-check.sh` proves a backup actually restores.

**What a backup contains:** Supabase's own `supabase db dump` output (roles,
schema, and all data, including user accounts and two-factor factors),
tarred and encrypted to a GPG public key. The newest 14 nightly and 8
weekly copies are kept. A dump missing the app's tables or its users is
refused, so older good backups are never rotated out for a broken one.

**One-time setup:**

1. **Create the backup key on a machine you trust** (not the backup host).
   Restoring needs the private key, so keep it and an offline copy safe;
   the backup host only ever gets the public key.

   ```bash
   gpg --quick-gen-key "FOQB backups <you@example.com>" default default never
   gpg --export --armor you@example.com > foqb-backup.pub.asc
   ```

2. **On the backup host**, import that public key:
   `gpg --import foqb-backup.pub.asc`.

3. **Get the connection string:** in the Supabase dashboard, open
   Connect → Session pooler (it works over IPv4; the direct connection
   needs IPv6). Put in your database password, percent-encoding any special
   characters.

4. **Create `~/.config/foqb-backup.env`** with `chmod 600`:

   ```bash
   FOQB_DB_URL='postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres'
   FOQB_BACKUP_GPG_RECIPIENT='you@example.com'
   # FOQB_BACKUP_DIR=~/foqb-backups   (default)
   ```

5. **Run it once by hand** (`scripts/backup-db.sh`). Then schedule it with
   `crontab -e`:

   ```cron
   MAILTO=you@example.com
   30 3 * * * cd /path/to/foqb && scripts/backup-db.sh >> ~/foqb-backups/backup.log 2>&1
   ```

   The script exits non-zero on any failure and records each success in
   `~/foqb-backups/last-success`.

**Monthly restore check,** on the machine that holds the private key:

```bash
scripts/restore-check.sh ~/foqb-backups/daily/foqb-<newest>.tar.gz.gpg
```

It restores the backup into a throwaway, empty local Supabase project (own
ports, removed afterwards; it can run next to a dev stack). It then reports
organizations, users and posted entries, fails if the ledger's debits and
credits don't match or if no users came back, and warns if the newest
backup is more than 36 hours old.

**Copying offsite** is up to you, for example `rclone` to Backblaze B2 or
Cloudflare R2. The files are already encrypted.

## 9. Running it all on your own server with Docker

Sections 1–3 use hosted Supabase and Vercel. To run everything on one
machine instead, use `docker/compose.yml`. It runs:

- the parts of Supabase the app needs: Postgres, Auth and the database API
  (PostgREST), behind an internal gateway;
- a one-shot container that applies `supabase/migrations`;
- the app itself.

Only the app is published (port 8090 by default). The browser never talks
to Supabase directly, so Supabase isn't reachable from outside.

```bash
docker/setup.sh https://books.example.com   # writes docker/.env with fresh secrets
# edit docker/.env: Plaid keys, operator details (§4)
cd docker && docker compose up -d
```

`.env` points at the released images on GitHub's container registry
(`ghcr.io/parkfour/foqb` and `ghcr.io/parkfour/foqb-migrate`). Pin a
version (`:0.6.0`) instead of `:latest` if you want to choose when to
upgrade. To build from your own checkout, empty `FOQB_APP_IMAGE` and
`FOQB_MIGRATE_IMAGE` and run `docker compose up -d --build` (the build also
copies the receipt-scanning plugin's OCR files into `public/ocr`). Each version
tag on the GitHub repository publishes new images (the `release-images`
CI job).

Point your reverse proxy (with TLS) at port 8090. The app takes the public
hostname from `X-Forwarded-Host`, which Apache's `ProxyPass` sets
automatically. No mail server is needed: new accounts work immediately
(`MAILER_AUTOCONFIRM`), and password-reset emails don't go out. Configure
Auth's `GOTRUE_SMTP_*` settings if you want them. (Emailing invoices is
separate: with the `email-invoices` plugin, each organization uses its own
mail server, set in Settings.)

Plugins are set in `docker/.env` too: `FOQB_PLUGINS` and, if your
organizations' mail servers are on your LAN, `ALLOW_PRIVATE_NETWORK_HOSTS`
(both in §2).

**The first account created becomes Site Admin.** Create yours before
sharing the URL. Back up the `db-data` volume like any Postgres database,
and keep `docker/.env`: the encryption key in it is the only way to read
the stored bank tokens.

### A public demo that resets itself

This repo's demo (<https://foqb.parkfour.com>) is this setup with:

- `DEMO_MODE=1`, which shows a "this is a demo, data is erased" banner and
  hides password reset;
- Plaid's sandbox keys;
- `docker/reset-demo.sh` running from cron every 6 hours. It deletes the
  database volume, starts over from the migrations, and creates a
  passwordless placeholder as the Site Admin, so no visitor gets the
  Site Admin console.

CI builds fresh images on the runner host for every push to main, so each
reset also picks up the latest code.

## 10. Keeping a private repository with a public mirror

This repository is developed on a private Gitea instance and published to
GitHub. The `publish` CI job (`scripts/publish-mirror.sh`) copies each new
commit on `main` to the mirror, with the same files, message and author. It
leaves out anything listed in `.gitdontforward`, which uses `.gitignore`
syntax. Here, that's the operator's filled-in policy documents
(`docs/*_parkfour.md`); the generic templates next to them are published.

The mirror's history starts with one commit holding the whole tree, so
development history from before publishing stays private. To set it up:

1. Create the empty GitHub repository.
2. Make an SSH key (`ssh-keygen -t ed25519 -N "" -f mirror-key`). Add
   `mirror-key.pub` to the GitHub repository as a deploy key with write
   access.
3. In the private repository, add the secrets `MIRROR_REPO` (e.g.
   `git@github.com:you/foqb.git`) and `MIRROR_DEPLOY_KEY` (the contents
   of `mirror-key`). Optionally add `MIRROR_AUTHOR_NAME` and
   `MIRROR_AUTHOR_EMAIL` to publish your commits under another identity (such
   as your GitHub noreply address). Also add `MIRROR_REPLACE_EMAILS` (your
   own git email addresses, comma-separated), so only your commits are
   renamed, not contributors'. Without it, every commit is renamed.
4. The next push to `main` publishes. Never push to the mirror directly:
   the job then refuses rather than overwrite it.

Commit messages are published as written, so keep them free of anything
private.
