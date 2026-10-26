#!/usr/bin/env node
// Proves this branch's new migrations apply over a book made by the last
// release, and leave its figures alone: production runs them (CI's
// `supabase db push`) on top of real data before the new app deploys.
//
//   node scripts/upgrade-check.mjs v0.7.0
//
// In a throwaway postgres:16-alpine (port 55441), it applies the
// migrations exactly as they were at <tag>, seeds a company and a household
// with that tag's sample scripts (scripts/seed-sample-*.sql) plus a stock
// item and a closed period, and records each book's trial balance and row
// counts. Then it applies the migrations <tag> didn't have, checks nothing
// moved, and posts, voids and reports on the upgraded books. Needs Docker,
// psql and git.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const tag = process.argv[2];
if (!tag) {
  console.error("usage: node scripts/upgrade-check.mjs <previous release tag, e.g. v0.7.0>");
  process.exit(2);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTAINER = "foqb-upgrade-check";
const PORT = 55441;
const url = `postgresql://postgres:postgres@localhost:${PORT}/postgres`;
const work = mkdtempSync(path.join(os.tmpdir(), "foqb-upgrade-"));
const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });

// The same Supabase stand-in the database tests use (tests/db/global-setup.ts).
const setup = readFileSync(path.join(root, "tests/db/global-setup.ts"), "utf8");
const sqlConst = (name) => setup.match(new RegExp(`const ${name} = \`([\\s\\S]*?)\`;`))[1];

function psql(args, input) {
  const r = spawnSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-q", ...args], { input, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`psql ${args.join(" ")}: ${r.error?.message ?? r.stderr}`);
}
const fileAt = (rev, file) => {
  const out = path.join(work, rev.replace(/\W/g, "_") + "-" + path.basename(file));
  writeFileSync(out, git("show", `${rev}:${file}`));
  return out;
};

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

async function figures(client, orgs) {
  const out = {};
  for (const [name, id] of Object.entries(orgs)) {
    const tb = await client.query("select account_id, total_debit::text, total_credit::text, balance::text from get_trial_balance($1, current_date + 400) order by account_id", [id]);
    const counts = await client.query(
      `select (select count(*) from journal_entries where organization_id = $1)::int entries,
              (select count(*) from journal_lines jl join journal_entries je on je.id = jl.journal_entry_id where je.organization_id = $1)::int lines,
              (select count(*) from invoices where organization_id = $1)::int invoices,
              (select count(*) from bills where organization_id = $1)::int bills,
              (select count(*) from bank_transactions where organization_id = $1)::int bank_rows,
              (select count(*) from accounts where organization_id = $1)::int accounts`,
      [id],
    );
    out[name] = { tb: tb.rows, counts: counts.rows[0] };
  }
  return out;
}

async function main() {
  spawnSync("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });
  execFileSync("docker", ["run", "-d", "--name", CONTAINER, "-e", "POSTGRES_PASSWORD=postgres", "-p", `${PORT}:5432`, "postgres:16-alpine"], { stdio: "ignore" });
  for (let i = 0; ; i++) {
    const c = new pg.Client({ connectionString: url });
    try {
      await c.connect();
      await c.end();
      break;
    } catch {
      await c.end().catch(() => {});
      if (i > 60) throw new Error("Postgres didn't start");
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  psql([], sqlConst("AUTH_STUB_SQL"));
  const old = git("ls-tree", "--name-only", tag, "supabase/migrations/").split("\n").filter((f) => f.endsWith(".sql")).sort();
  const now = git("ls-files", "supabase/migrations/").split("\n").filter((f) => f.endsWith(".sql")).sort();
  const added = now.filter((f) => !old.includes(f));
  console.log(`${tag}: ${old.length} migrations; this branch adds ${added.length}: ${added.map((f) => path.basename(f).slice(11, 14)).join(", ")}`);
  for (const f of old) psql(["-f", fileAt(tag, f)]);
  psql([], `insert into auth.users (email) values ('seed@example.com');`);

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const user = (await client.query("insert into auth.users (email) values ('owner@example.com') returning id")).rows[0].id;
  const orgs = {};
  for (const [name, kind] of [["company", "business"], ["household", "household"]]) {
    const id = (await client.query("insert into organizations (name, workspace_type) values ($1, $2) returning id", [`Upgrade ${name}`, kind])).rows[0].id;
    await client.query("insert into organization_members (organization_id, user_id, role) values ($1, $2, 'owner')", [id, user]);
    await client.query(
      `insert into accounts (organization_id, account_number, name, type) values
        ($1, '1000', 'Cash', 'asset'), ($1, '1200', 'Accounts Receivable', 'asset'), ($1, '2000', 'Accounts Payable', 'liability'),
        ($1, '3000', 'Owner''s Equity', 'equity'), ($1, '4000', 'Revenue', 'revenue'), ($1, '5000', 'Operating Expenses', 'expense')`,
      [id],
    );
    psql(["-v", `org=${id}`, "-f", fileAt(tag, `scripts/seed-sample-${name}.sql`)]);
    orgs[name] = id;
  }
  // What the seeds don't cover: a stock item, and a closed period.
  await client.query(
    "insert into items (organization_id, name, income_account_id, track_quantity, quantity_on_hand) select $1, 'Beans', id, true, 12 from accounts where organization_id = $1 and account_number = '4000'",
    [orgs.company],
  );
  await client.query("update organizations set period_lock_date = current_date - 92 where id = $1", [orgs.company]);

  const before = await figures(client, orgs);
  console.log("before:", JSON.stringify(Object.fromEntries(Object.entries(before).map(([k, v]) => [k, v.counts]))));
  for (const f of added) psql(["-f", path.join(root, f)]);
  psql([], sqlConst("GRANTS_SQL"));
  const after = await figures(client, orgs);

  for (const name of Object.keys(orgs)) {
    check(JSON.stringify(after[name].counts) === JSON.stringify(before[name].counts), `${name}: row counts unchanged ${JSON.stringify(after[name].counts)}`);
    check(JSON.stringify(after[name].tb) === JSON.stringify(before[name].tb), `${name}: trial balance unchanged (${after[name].tb.length} accounts)`);
  }
  check((await client.query("select count(*)::int n from plugin_events")).rows[0].n === 0, "migrating recorded no plugin events");
  check(
    (await client.query("select on_hand::int n from item_stock where organization_id = $1", [orgs.company])).rows[0]?.n === 12,
    "stock item's count carried over",
  );
  check((await client.query("select count(*)::int n from accounts where currency is not null")).rows[0].n === 0, "every existing account stays in the book's currency");

  // Using the upgraded books, as the owner.
  await client.query("begin");
  await client.query("set local role authenticated");
  await client.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.aal', 'aal2', true)", [user]);
  const acct = async (org, n) => (await client.query("select id from accounts where organization_id = $1 and account_number = $2", [org, n])).rows[0].id;
  const [cash, revenue] = [await acct(orgs.company, "1000"), await acct(orgs.company, "4000")];
  const lines = JSON.stringify([
    { account_id: cash, debit: 10, credit: 0 },
    { account_id: revenue, debit: 0, credit: 10 },
  ]);
  const posted = await client.query("select post_journal_entry($1, current_date, 'After upgrade', $2::jsonb) id", [orgs.company, lines]).then(
    (r) => r.rows[0].id,
    (e) => e,
  );
  check(typeof posted === "string", `posting an entry works${posted instanceof Error ? `: ${posted.message}` : ""}`);
  await client.query("savepoint locked");
  const locked = await client.query("select post_journal_entry($1, current_date - 93, 'In the closed period', $2::jsonb)", [orgs.company, lines]).then(
    () => null,
    (e) => e.message,
  );
  await client.query("rollback to savepoint locked");
  check(locked !== null, `the closed period stays closed (${locked})`);

  const paid = (await client.query(`select i.id from invoices i join organizations o on o.id = i.organization_id
      where i.organization_id = $1 and i.status in ('paid', 'partial') and i.invoice_date > o.period_lock_date
        and not exists (select 1 from invoice_payments p where p.invoice_id = i.id and p.payment_date <= o.period_lock_date)
      order by i.invoice_date limit 1`, [orgs.company])).rows[0];
  if (paid) {
    await client.query("savepoint v");
    const voided = await client.query("select void_invoice($1)", [paid.id]).then(
      () => null,
      (e) => e.message,
    );
    if (voided) await client.query("rollback to savepoint v");
    check(voided === null || /reconciled|closed|lock/i.test(voided), `voiding a paid invoice from before the upgrade: ${voided ?? "voided"}`);
  } else {
    console.log("skip no paid invoice in the sample to void");
  }
  for (const [what, sql] of [
    ["general ledger", "select count(*) from get_general_ledger($1, current_date - 120, current_date)"],
    ["P&L by class", "select count(*) from get_income_statement_by_class($1, current_date - 120, current_date)"],
    ["foreign balances", "select count(*) from get_foreign_balances($1, current_date)"],
  ]) {
    await client.query("savepoint r");
    const err = await client.query(sql, [orgs.company]).then(
      () => null,
      (e) => e.message,
    );
    if (err) await client.query("rollback to savepoint r");
    check(err === null, `${what} runs on old entries${err ? `: ${err}` : ""}`);
  }
  await client.query("commit");
  check((await client.query("select count(*)::int n from plugin_events where event = 'journal_entry:posted'")).rows[0].n >= 1, "posting after the upgrade records a plugin event");
  await client.end();
}

try {
  await main();
} catch (err) {
  failures.push(String(err));
  console.error(err);
} finally {
  spawnSync("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });
  rmSync(work, { recursive: true, force: true });
}
console.log(failures.length ? `\n${failures.length} failed` : "\nThe upgrade from " + tag + " checks out.");
process.exit(failures.length ? 1 : 0);
