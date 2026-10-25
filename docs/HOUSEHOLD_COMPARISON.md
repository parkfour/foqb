# Household books compared

How a FOQB household book ([HOUSEHOLD.md](HOUSEHOLD.md)) compares with
open-source and paid personal finance software. Prices were checked in
October 2026 and change often, and most paid apps charge less in the first
year than at renewal. Check each vendor's site before you choose. A "?"
marks something we couldn't confirm.

## Open source

| | **FOQB household** | Firefly III | Actual Budget | GnuCash | KMyMoney |
|---|---|---|---|---|---|
| License | AGPL-3.0 | AGPL-3.0 | MIT | GPL | GPL |
| Runs as | Web app / PWA, self-hosted or hosted | Web app, self-hosted | Web or desktop app, local-first with an optional sync server | Desktop | Desktop |
| Double-entry ledger | ✅ | ✅ | ❌ (budget-first) | ✅ | ✅ |
| Live bank feed | ✅ Plaid (pushed as it happens) or SimpleFIN (every few hours) | Separate Data Importer (SimpleFIN, GoCardless and others) | "Bank Sync" button (SimpleFIN, GoCardless, Pluggy) | File import (OFX/QIF/CSV); AqBanking for some banks | File import (OFX/QIF/CSV); AqBanking for some banks |
| Budgeting | Monthly amount per expense account, optional rollover (sinking funds) | Budgets, piggy banks | Envelope (zero-based) budgeting | Budgets | Budgets |
| Net worth | ✅ every figure opens its accounts; history chart | ✅ | ✅ report | ✅ report | ✅ report |
| Investment holdings and prices | ❌ balances only | ❌ balances only | ❌ balances only | ✅ | ✅ |
| Property values | ✅ entered by hand | as an asset account | as an account | as an asset account | as an asset account |
| Several people, with roles | ✅ owner / accountant / viewer, two-factor | mostly one user | ✅ with a sync server | ❌ | ❌ |
| Business books beside the household | ✅ same login; business equity rolls into net worth; one event posts to both books | ❌ | ❌ | ✅ in one file (invoices, bills) | ❌ |
| Tax lines | ✅ Form 1040 with Schedules 1, B, C, D, E; per-rental Schedule E | ❌ | ❌ | ✅ US tax report (TXF) | ✅ tax report |
| Multi-currency | one currency per book; other-currency businesses shown at a quote | ✅ | ❌ | ✅ | ✅ |
| Cost | $0 on your own server, plus Plaid's per-bank fees | $0 (bank feed providers may charge; SimpleFIN is about $15/year) | $0 (same) | $0 | $0 |

**Where FOQB fits:** pick it if you want household and business books in
one place, shared with your spouse or accountant under separate roles, with
the bank feed arriving by itself. Firefly III is the closest open-source
match for a self-hosted double-entry web app. Actual is the better choice
for envelope budgeting. GnuCash and KMyMoney are better if you track
investment lots and prices, and don't need a web app or several users.

## Paid

| | **FOQB household** | Quicken Classic | Quicken Simplifi | Monarch Money | YNAB | Copilot Money |
|---|---|---|---|---|---|---|
| Runs as | Web app / PWA | Windows / Mac desktop, with a mobile companion | Web and mobile | Web and mobile | Web and mobile | iPhone, iPad, Mac |
| Double-entry ledger | ✅ | ❌ (register-based) | ❌ | ❌ | ❌ | ❌ |
| Bank feed | ✅ Plaid | ✅ | ✅ | ✅ | ✅ | ✅ |
| Budgeting | Monthly per account, with rollover | ✅ | Spending plan | ✅ | Zero-based, its core | ✅ |
| Investment holdings | ❌ | ✅ (more tools in Premier) | ✅ | ✅ | ❌ balances only | ✅ |
| Property values | entered by hand | entered by hand | ? | ✅ automatic home value (Zillow) | as a tracking account | ? |
| Business or rentals | ✅ full business books; per-rental Schedule E | Business & Personal plan: Schedule C/E, invoices, rentals | ❌ | ❌ | ❌ | ❌ |
| Household members | ✅ any number, with roles | one data file | ? | shared household | up to 6 people | one person per subscription |
| Your data | in your own database; full backup and restore | local file | vendor's cloud | vendor's cloud | vendor's cloud | vendor's cloud |
| Price (Oct 2026, renewal) | $0 self-hosted | roughly $60–130/year, by plan | roughly $70–85/year | about $100/year | about $109/year | about $95/year |

**Where FOQB fits:** against Quicken Classic, FOQB gives you a real
double-entry ledger, a web app several people can use at once, and no
subscription. Quicken still wins on investments, bill pay and years of
polish. Against Monarch, YNAB, Simplifi and Copilot, those apps have
better phone apps and investment tracking, and Monarch values your home
automatically; FOQB has
real books, business books beside the household, tax lines, and your
data on your own server.

## FOQB's gaps for households

- **No investment holdings.** Brokerage and retirement accounts count only
  through their ledger balances (see [HOUSEHOLD.md](HOUSEHOLD.md#investments-not-included)).
- **No automatic property values.** They're entered by hand.
- **Budgets are simple:** a monthly amount per expense account, which can
  roll over, but no zero-based envelope budgeting (giving every dollar of
  income a job, as YNAB and Actual do).
- **No native phone app.** It's an installable web app (PWA).
- **Bank feeds for self-hosters.** SimpleFIN (about $15 a year) needs no
  approval; Plaid needs your own approved account. Without either, the
  statement import plugin and CSV import still work ([BANK_FEED.md](BANK_FEED.md)).
