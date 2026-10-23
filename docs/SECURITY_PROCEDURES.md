# FOQB Information Security Procedures

<!--
Template. Copy it, replace every [bracketed] item, and delete anything
that doesn't describe how you actually run your instance. It's written for
the reference setup in docs/SELF_HOSTING.md (Vercel, Supabase, Plaid, a Git
host with CI). A bank-data provider's security review will ask for a
document like this. Keep it true: it's only useful if it matches practice.
-->

**Operator:** [Operator legal name]\
**Service:** FOQB (<[https://your-instance.example]>)\
**Security owner:** [Name], [Operator legal name]\
**Last reviewed:** [Date]

These procedures put into practice the information security policy published
at [https://your-instance.example]/security. That page describes *what* we do.
This document describes *how*: who does it, when, and the steps to follow.
They are reviewed at least once a year, and whenever the systems or practices
they describe change.

---

## 1. Scope and systems

FOQB is a multi-tenant bookkeeping application. It stores organizations'
accounting records and, when they connect a bank, bank transaction data
retrieved through Plaid.

| System | Purpose | Holds |
|---|---|---|
| Vercel | Application hosting | Production environment secrets |
| Supabase | Postgres database and user authentication | All customer data; encrypted Plaid access tokens |
| Plaid | Bank connections | Bank credentials and connections (never stored by FOQB) |
| [Git host, e.g. Gitea or GitHub], with its CI | Source code and CI/CD pipeline | Code; deployment secrets for the pipeline |

**Secrets** are held only in Vercel's environment settings and the Git
host's repository secrets, never in the source code or the repository:

- the Supabase service-role key;
- `ENCRYPTION_KEY`, which encrypts Plaid access tokens at rest (AES-256-GCM);
- the Plaid client secret;
- `CRON_SECRET`;
- the CI pipeline's Supabase access token, database password and Vercel deploy token.

## 2. Access control policy

This section is FOQB's access control policy. It covers who may access
what, how access is granted, authenticated, reviewed and removed.


- **Security owner.** The security owner is responsible for these
  procedures, for every administrative account, and for incident response.
  [Operator legal name] currently has [number] people in this role and
  [no other staff / these other staff] with production access.
- **Least privilege.** Administrative access to Vercel, Supabase, Plaid and
  the Git host is limited to the security owner. Any additional person is granted
  only the access their task needs, and it is removed as soon as the task
  is done.
- **Central identity (IAM).** [Identity provider, e.g. Google Workspace
  (`your-domain.example`)] is the single identity provider for workforce
  access:
  - **Sign-in through it:** [the systems that use it for sign-in]. Access
    to them is granted and removed through the identity provider.
  - **Documented exceptions:** [any system that can't use it, how its
    account is tied back to the identity provider, and the MFA it uses].
  - **Break-glass access:** [how you get in if the identity provider is
    unavailable, and how that access is protected].
  - **Service credentials** are not tied to a person's identity. These are
    the CI deployment and migration tokens, [any deployment keys], and the
    backup host's database credential. They are listed in section 1,
    rotated per section 4, and included in the quarterly review.
- **Strong authentication.**
  - Multi-factor authentication is required on every identity-provider
    account, which protects every system that signs in through it.
    Documented exceptions use their own authenticator MFA.
  - Application users can enable TOTP two-factor authentication. Once a
    user has, the database itself refuses access from their session until
    the second factor is completed.
- **Offboarding.** To remove someone's access:
  1. Suspend their identity-provider account. This ends their sign-in to
     every system that uses it, and stops mail delivery for account
     recovery.
  2. Remove them from any documented exception and any team memberships.
  3. Remove any mail routing to them.
  4. Rotate every service credential they knew (section 4).
- **Customer access.**
  - Within each organization, owners grant roles (owner, accountant,
    viewer).
  - Isolation between organizations is enforced by the database
    (Postgres row-level security), not only by application code. The few
    functions that skip it for speed (the reports, the register's per-row
    checks) check the caller's membership themselves, with the same
    two-factor rule, and are tested for it.
  - The operator's site-administrator actions on an organization are
    separately logged.
  - Connecting or reconnecting a bank (Plaid Link) requires the user to
    have two-factor authentication and to have completed it in the current
    session. The API checks this, and the database refuses a new bank
    connection from any session that hasn't.
  - Connecting banks can be turned off for the whole Service by a site
    administrator, or for one organization by its owners. The API and the
    database both enforce this.
  - Self-service sign-up can be turned off by a site administrator. The
    database then refuses any new account that a site administrator or
    organization owner didn't create.
  - Every change a site administrator makes to these settings is logged.
- **Quarterly access review.** Every quarter, the security owner reviews
  each system's list of administrative users and API keys, and removes
  anything no longer needed. The review is recorded in the review log
  (section 11).

## 3. Change management

1. All code changes are committed to the [Git host] repository.
2. Every push runs the CI pipeline: type checking, linting, unit tests,
   component tests, and database integration tests against a real Postgres
   with every migration applied. A change that fails any step is not
   deployed.
3. Database schema changes are applied **only** by the pipeline, through
   versioned migration files (`supabase/migrations/`), after the tests pass.
   No one changes the production schema by hand.
4. Deployments to production run from the pipeline, never from a developer
   machine.
5. Changes to authentication, authorization, or the handling of bank data
   get a focused security review before they are merged. They also get
   regression tests for any security property they introduce or rely on.

## 4. Secret and key rotation

Rotate a secret **immediately** if it is suspected to be exposed. Otherwise,
rotate it when someone with access to it leaves.

| Secret | Rotation steps |
|---|---|
| Plaid secret | 1. Generate a new secret in the Plaid Dashboard.<br>2. Update `PLAID_SECRET` in Vercel and redeploy.<br>3. Revoke the old secret. |
| Supabase service-role key or JWT secret | 1. Rotate it in the Supabase dashboard.<br>2. Update the Vercel environment and redeploy. Existing user sessions end and users sign in again. |
| `CRON_SECRET` | Generate a new value (`openssl rand -hex 32`), update Vercel, and redeploy. |
| `ENCRYPTION_KEY` | 1. Remove every connected bank Item at Plaid, which invalidates every stored access token.<br>2. Set a new key (`openssl rand -base64 32`) in Vercel and redeploy.<br>3. Ask users to reconnect their banks. Without a valid Plaid secret, an exposed token is unusable, but treat any exposure as an incident (section 5). |
| CI pipeline tokens (Supabase, Vercel) | Revoke and reissue the token in that provider, then update the Git host's repository secret. |

## 5. Incident response

An incident is any suspected unauthorized access to customer data, secrets,
or administrative accounts, or a vulnerability that could allow it. Reports
come from users or researchers through the security contact published at
[https://your-instance.example]/security, from provider alerts, or from our own
monitoring.

1. **Acknowledge** the report within 2 business days, and record the time
   it was received.
2. **Triage:** confirm whether it is real, and identify what data,
   organizations, and systems are affected.
3. **Contain:**
   - rotate the affected secrets (section 4);
   - revoke sessions or disable affected accounts;
   - remove affected Plaid Items if bank access may be exposed;
   - roll back a bad deployment through Vercel if needed.
4. **Fix** the root cause through the normal change process (section 3),
   including a regression test.
5. **Notify** affected organizations directly, without undue delay once an
   incident is confirmed to have exposed their data. Also notify Plaid if
   Plaid data or credentials were involved, and meet any legal notification
   obligation.
6. **Review:** write a short post-incident summary covering the timeline,
   cause, impact, fix, and any changes to these procedures. Add it to the
   review log.

## 6. Vulnerability management

- **Dependencies:**
  - **Scanned automatically on every push:** CI runs `npm audit` against
    everything that ships to production, and a high or critical advisory
    fails the build, so it cannot deploy. Fixes go through the normal
    change process.
  - **Reviewed monthly:** outdated packages are updated, and advisories
    in development-only tooling (never deployed) are checked. Those with
    no patched release are noted here until one exists.
- **Patching SLA:** once a vulnerability affecting FOQB is identified (by
  the CI scan, the monthly review, a provider advisory or an external
  report), it is fixed and deployed within:

  | Severity | Deadline |
  |---|---|
  | Critical | 7 days |
  | High | 30 days |
  | Medium | 90 days |
  | Low | Next routine dependency update |

  Severity is the advisory's own rating (CVSS where available), adjusted
  for whether the vulnerable code is actually reachable in FOQB. A
  critical or high advisory in production dependencies also blocks every
  deployment until it is fixed. If a fix isn't available in time, the
  issue is mitigated (for example by disabling the affected feature), and
  the exception is recorded in the review log.
- **Infrastructure:** production runs on managed platforms (Vercel for
  hosting, Supabase for the database), which patch their own
  infrastructure; FOQB runs no servers of its own.
- **Operator machines:** [the machines that hold credentials or backups]
  install operating-system security updates automatically ([how, e.g.
  `unattended-upgrades`, daily]).
- **Code review:** review the codebase for security and logic issues at
  least quarterly, and before major features that touch authentication,
  permissions, or bank data. Findings get a fix and a regression test. The
  most recent full review was completed and deployed in [month year].
- **External reports** are handled as incidents (section 5).

## 7. Data protection, backup and recovery

- **Encryption:** all traffic uses TLS. Plaid access tokens are encrypted
  at rest with AES-256-GCM. Ordinary org members cannot read even the
  encrypted token; only server-side code can.
- **Bank credentials:** never seen or stored by FOQB. Users enter them only
  in Plaid Link.
- **Backups:**
  - **Nightly:** a scheduled job on [an operator-controlled machine] dumps
    the whole database, including user accounts, using Supabase's
    documented method (`scripts/backup-db.sh`). Each dump is encrypted to
    a GPG public key before it is stored; the private key is kept off the
    backup machine. The newest 14 nightly and 8 weekly copies are kept. A
    dump missing the application's tables or users is rejected, so it
    never replaces a good backup.
  - **Monthly restore test:** a backup is restored into a fresh, empty
    Supabase project (`scripts/restore-check.sh`). The test verifies that
    users and organizations come back and that the restored ledger
    balances (debits equal credits). The result is recorded in the review
    log.
  - **Per-organization:** owners can also download a complete backup of
    their organization at any time (Settings), and restore it into a new
    organization. Automated tests cover that restore.
- **Retention and deletion:** handled as described in the Privacy Policy
  ([https://your-instance.example]/privacy). Deleting an organization removes
  its records, and disconnecting a bank removes the connection at Plaid.

## 8. Logging and monitoring

- **Application logs:** errors and security-relevant events are logged to
  Vercel's runtime logs. These include failed webhook signature checks,
  bank sync failures, and changes reported by the bank to transactions that
  were already booked.
- **Audit log:** changes to accounting records and organization membership
  are recorded in a database audit log, which members of the affected
  organization can see. The audit log is written by database triggers, so
  application code cannot skip it.
- **Plaid webhooks:** each one is verified against Plaid's signing keys
  before it is processed. Keys Plaid has marked expired are rejected.

## 9. End-of-life software management

Software that no longer receives security updates is replaced before its
end of life.

- **Inventory:**
  - **Application runtime:** Node.js (CI and Vercel, currently 24 LTS),
    Next.js (currently 16), and the npm dependencies in `package-lock.json`.
  - **Database:** Supabase-managed PostgreSQL (currently 17). Supabase
    announces and schedules major-version upgrades.
  - **Operator machines:** [each machine and its operating system and
    version, and what runs on it].
  - **Hosted services** (Vercel, Supabase, Plaid, [identity provider]) are
    maintained by their providers.
- **Quarterly check:** with the access review, each inventory item's
  support status is checked against its publisher's lifecycle page (or
  endoflife.date). The inventory above is updated at the same time.
- **Before end of life:** anything within 6 months of its end of life is
  scheduled for upgrade through the normal change process. It is upgraded
  before support ends. Unsupported software is not kept in use; any
  temporary exception is recorded in the review log with a removal date.
- **Dependencies:** packages marked deprecated or unmaintained are
  replaced as part of the monthly dependency review.

## 10. Zero-trust access architecture

No network location is trusted. Every access is authenticated, authorized
and limited to what it needs:

- **No trusted network.** There is no VPN or private network that grants
  access. The application, database API and admin consoles are reached
  over TLS on the public internet, and every request is authenticated on
  its own.
- **Every request is authorized, per row.** Application requests carry a
  short-lived signed token. The database checks it on every query (row-level
  security), limiting each user to their own organizations and role. A bug
  in application code cannot by itself widen that access.
- **Strong, continuous verification.** Workforce access goes through
  [identity provider] with enforced multi-factor authentication, and MFA on
  any documented exception. For users who have enabled two-factor, the database refuses
  any session that hasn't completed it. Bank connections always require it.
- **Least privilege for services.** The service-role key is used only by
  server-side code paths that need it (bank sync, webhooks, deletion).
  Database functions that run with elevated rights check the caller's
  membership and role themselves, and internal-only ones cannot be called
  by users at all.
- **Verify, don't trust, inbound calls.** Plaid webhooks are accepted only
  with a valid signature from Plaid's current keys. Cron triggers require a
  secret, and fail closed when it isn't set.
- **Assume breach.** Plaid tokens are encrypted at rest. Backups are
  encrypted to a key kept off the backup machine. Every change to records
  and memberships is written to an audit log by database triggers.

## 11. Review log

| Date | Activity |
|---|---|
| [YYYY-MM-DD] | These procedures adopted. |
