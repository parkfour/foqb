import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { asUser, createAccount, createOrg, createUser, newId } from "./helpers";

describe("plugin events the database records (20260101000097)", () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: inject("databaseUrl") });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  beforeEach(async () => {
    await client.query("BEGIN");
  });

  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  const events = async (org: string) =>
    (await client.query("select event, payload from plugin_events where organization_id = $1 order by id", [org])).rows as {
      event: string;
      payload: Record<string, unknown>;
    }[];

  it("records an entry when it's posted, once, a new bank row, and a period lock", async () => {
    const org = await createOrg(client);
    const cash = await createAccount(client, org, { type: "asset", name: "Cash" });
    const sales = await createAccount(client, org, { type: "revenue", name: "Sales" });
    const entry = newId();
    await client.query("insert into journal_entries (id, organization_id, entry_date, memo, status) values ($1, $2, '2026-10-01', 'Sale', 'draft')", [entry, org]);
    await client.query("insert into journal_lines (journal_entry_id, account_id, debit, credit) values ($1, $2, 5, 0), ($1, $3, 0, 5)", [entry, cash, sales]);
    expect(await events(org)).toEqual([]);

    await client.query("update journal_entries set status = 'posted' where id = $1", [entry]);
    await client.query("update journal_entries set memo = 'Sale!' where id = $1", [entry]);
    await client.query(
      "insert into bank_transactions (organization_id, account_id, external_transaction_id, date, name, amount) values ($1, $2, $3, '2026-10-02', 'COFFEE', -4.5)",
      [org, cash, newId()],
    );
    await client.query("update organizations set period_lock_date = '2026-09-30' where id = $1", [org]);
    await client.query("update organizations set name = 'Renamed' where id = $1", [org]);

    expect(await events(org)).toMatchObject([
      { event: "journal_entry:posted", payload: { journalEntryId: entry, entryDate: "2026-10-01", memo: "Sale" } },
      { event: "bank_transaction:imported", payload: { accountId: cash, date: "2026-10-02", name: "COFFEE", amount: -4.5 } },
      { event: "period:locked", payload: { lockDate: "2026-09-30", previousLockDate: null } },
    ]);
  });

  it("hands events over once, oldest first", async () => {
    const org = await createOrg(client);
    await client.query("update organizations set period_lock_date = '2026-01-31' where id = $1", [org]);
    await client.query("update organizations set period_lock_date = '2026-02-28' where id = $1", [org]);
    const claimed = (await client.query("select event, payload from claim_plugin_events(10) where organization_id = $1", [org])).rows;
    expect(claimed.map((r) => r.payload.lockDate).sort()).toEqual(["2026-01-31", "2026-02-28"]);
    expect(await events(org)).toEqual([]);
  });

  it("records nothing for a restored book", async () => {
    const orgId = newId();
    const [cash, sales, entry] = [newId(), newId(), newId()];
    await asUser(client, await createUser(client, "events-restorer@example.com"));
    await client.query("select restore_organization($1)", [
      JSON.stringify({
        organization: { id: orgId, name: "Restored" },
        accounts: [
          { id: cash, organization_id: orgId, account_number: "1000", name: "Cash", type: "asset", is_active: true },
          { id: sales, organization_id: orgId, account_number: "4000", name: "Sales", type: "revenue", is_active: true },
        ],
        journal_entries: [
          { id: entry, organization_id: orgId, entry_date: "2026-10-01", memo: "Sale", status: "posted", journal_lines: [
            { id: newId(), journal_entry_id: entry, account_id: cash, debit: 5, credit: 0 },
            { id: newId(), journal_entry_id: entry, account_id: sales, debit: 0, credit: 5 },
          ] },
        ],
        customers: [], vendors: [], invoices: [], bills: [], invoice_payments: [], bill_payments: [], items: [], inventory_items: [],
        fixed_assets: [], recurring_invoices: [], recurring_bills: [], bank_transactions: [], bank_reconciliations: [], categorization_rules: [],
      }),
    ]);
    await client.query("RESET ROLE");
    expect((await client.query("select status from journal_entries where id = $1", [entry])).rows[0].status).toBe("posted");
    expect(await events(orgId)).toEqual([]);
  });

  it("isn't readable by signed-in users", async () => {
    const org = await createOrg(client);
    await client.query("update organizations set period_lock_date = '2026-01-31' where id = $1", [org]);
    await asUser(client, await createUser(client, "events-reader@example.com"));
    await expect(client.query("select * from plugin_events")).rejects.toThrow(/permission denied/);
  });
});
