# FOQB Data Retention and Disposal Policy

<!--
Template. Copy it, replace every [bracketed] item, and change the retention
periods to what your instance actually does. The schedule below matches the
code in this repository and the backup scripts as shipped
(scripts/backup-db.sh).
-->

**Operator:** [Operator legal name]\
**Service:** FOQB (<[https://your-instance.example]>)\
**Policy owner:** [Name], [Operator legal name]\
**Last reviewed:** [Date]

This policy defines how long FOQB keeps each kind of data, including bank
data received through Plaid, and how that data is disposed of. It
implements the retention and deletion terms of the public Privacy Policy
([https://your-instance.example]/privacy), and sits alongside the Information
Security Procedures.

---

## 1. Principles

- **Minimization.** We collect only what the Service needs. Bank login
  credentials are never received or stored; users enter them only in
  Plaid Link.
- **Kept only for the purpose.** Customer data is kept while the
  customer's organization uses the Service, because it is their
  bookkeeping record. Operational data, such as rate-limiting records, is
  kept only as long as it is useful, then deleted automatically.
- **Enforced by the system.** Wherever possible, retention and disposal
  happen automatically, in code or scheduled jobs, rather than relying on
  someone remembering.
- **Disposal is complete.** Deleting an organization removes its records
  from the database, ends its bank connections at Plaid, and ages its data
  out of backups within a fixed period.

## 2. Retention schedule

| Data | Retained | Disposal |
|---|---|---|
| Organization accounting records: chart of accounts, journal entries, invoices, bills, payments, customers, vendors, items, assets, reconciliations, categorization rules | While the organization exists | Permanently deleted when the organization is deleted (section 3) |
| Bank data from Plaid: transactions, account names and last-4 digits | Part of the organization's books. Kept while the organization exists, including after a bank is disconnected | Deleted with the organization |
| Plaid access tokens (encrypted, AES-256-GCM) | While the bank connection is active | Invalidated at Plaid immediately when the user disconnects the bank or the organization is deleted (the Plaid Item is removed); the stored ciphertext is deleted with the organization |
| Organization audit log | While the organization exists | Deleted with the organization |
| User accounts (email, password hash, two-factor factors) | Until the user asks for deletion | Deleted on request (section 4) |
| Consent records: which version of the Terms and Privacy Policy each user accepted, and when | For the life of the user's account; append-only (cannot be edited or deleted) | Deleted with the user's account |
| Owner-created accounts that are never signed into | 7 days | Deleted automatically by a scheduled job |
| Sign-up exemptions (the email address of an account a site administrator or owner is creating) | Until that account is created, normally under a second | Deleted as soon as the account is created or creation fails. Ignored after 10 minutes in any case |
| Rate-limiting records (IP addresses and email addresses used as keys) | 24 hours | Deleted automatically by a scheduled job |
| Record of a deleted organization: its name and deletion date only, no financial data | Indefinitely | Kept so former members can be told what happened to the organization |
| Site-administrator action log: which administrator acted, which organization, and its former members' user IDs | Indefinitely | Kept for accountability |
| Encrypted database backups | 14 nightly and 8 weekly copies | Older copies deleted automatically when each new backup is made. Any offsite copies follow the same schedule |
| Application and platform logs (Vercel, Supabase) | The hosting providers' platform log-retention windows (hours to days) | Expire automatically. Not exported or archived by FOQB |
| Data held by Plaid itself | Governed by Plaid's own policy | Disconnecting a bank or deleting the organization removes the Item at Plaid |

## 3. Organization deletion

When an organization is deleted, at its owner's request or by the
operator for cause:

1. A site administrator runs the deletion, which removes every record
   belonging to the organization in a single database operation. That
   covers accounting records, bank data, encrypted access tokens, the audit
   log, rules, and memberships.
2. Each of the organization's live bank connections is then removed at
   Plaid, ending Plaid's authorization to access the bank on the
   organization's behalf.
3. Only the organization's name and deletion date are kept, plus the
   site-administrator log entry for the deletion.
4. Copies in backups disappear as the backups rotate: within 14 days from
   the nightly set, and within 8 weeks from the weekly set. Backups are
   encrypted, and are never restored except for disaster recovery or
   restore testing.

Owners can download a complete export of their organization (Settings)
before asking for deletion.

## 4. Requests from individuals

- Users can ask for deletion of their account or their organization's
  data through the contact address in the Privacy Policy.
- **Verification:** the operator confirms that the request comes from the
  account holder, or from an owner of the organization concerned.
- **Timing:** requests are completed within 30 days. A user can stop bank
  data collection at any time, immediately, by disconnecting the bank in
  Settings.
- **Legal holds:** where the law requires a record to be kept, it is kept
  only as long as required, and the requester is told what was kept and
  why.

## 5. Disposal methods

- **Database records:** deleted with SQL `DELETE`. The underlying storage
  is managed by Supabase and is encrypted at rest.
- **Bank connections:** removed through Plaid's `/item/remove` API, which
  invalidates the access token.
- **Backups:** deleted by the rotation in `scripts/backup-db.sh`. Each
  backup is encrypted to a key held off the backup machine, so a stray
  copy cannot be read without that key.
- **Restore tests:** each check runs in a throwaway local database that is
  deleted as soon as it finishes.

## 6. Legal basis and compliance

This policy is written to meet the privacy requirements that apply to
[describe your service and jurisdiction, e.g. a small US-based bookkeeping
service handling consumer financial data]. It follows minimization, purpose
limitation, and timely deletion on request. [State whether legal counsel
has reviewed it.]

## 7. Review

This policy is reviewed at least once a year, together with the
Information Security Procedures. It is also reviewed whenever the data
FOQB collects, its service providers, or the applicable laws change.
Changes that affect users are reflected in the Privacy Policy.

| Date | Change |
|---|---|
| [YYYY-MM-DD] | Policy adopted. |
