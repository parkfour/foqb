import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { addMember, asUser, createCustomer, createOrg, createUser, newId } from "./helpers";

describe("time entries (20260101000088)", () => {
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

  const insert = "insert into time_entries (organization_id, customer_id, work_date, hours) values ($1, $2, '2026-10-01', $3)";

  it("lets writers log hours for their own customers, refuses viewers and impossible hours", async () => {
    const org = await createOrg(client);
    const other = await createOrg(client, "Other");
    const owner = await createUser(client, "time-owner@example.com");
    const viewer = await createUser(client, "time-viewer@example.com");
    await addMember(client, org, owner, "owner");
    await addMember(client, org, viewer, "viewer");
    const ann = await createCustomer(client, org);
    const theirs = await createCustomer(client, other);

    await asUser(client, owner);
    await client.query(insert, [org, ann, 2.5]);
    for (const [customer, hours, message] of [[theirs, 1, /same organization/], [ann, 25, /check constraint/], [ann, 0, /check constraint/]] as const) {
      await client.query("SAVEPOINT s");
      await expect(client.query(insert, [org, customer, hours])).rejects.toThrow(message);
      await client.query("ROLLBACK TO SAVEPOINT s");
    }

    await client.query("RESET ROLE");
    await asUser(client, viewer);
    expect((await client.query("select hours::float from time_entries")).rows).toEqual([{ hours: 2.5 }]);
    await client.query("SAVEPOINT s");
    await expect(client.query(insert, [org, ann, 1])).rejects.toThrow(/row-level security/);
    await client.query("ROLLBACK TO SAVEPOINT s");
  });

  it("restores time entries from a backup", async () => {
    const orgId = newId();
    const customer = newId();
    const snapshot = {
      organization: { id: orgId, name: "Restored Hours" },
      customers: [{ id: customer, organization_id: orgId, name: "Ann", is_active: true }],
      time_entries: [{ id: newId(), customer_id: customer, work_date: "2026-03-02", hours: 3, description: "Audit", billable: true, rate: 120 }],
      accounts: [], journal_entries: [], vendors: [], invoices: [], bills: [], invoice_payments: [], bill_payments: [], items: [],
      inventory_items: [], fixed_assets: [], recurring_invoices: [], recurring_bills: [], bank_transactions: [], bank_reconciliations: [],
      categorization_rules: [],
    };
    await asUser(client, await createUser(client, "time-restorer@example.com"));
    await client.query("select restore_organization($1)", [JSON.stringify(snapshot)]);
    await client.query("RESET ROLE");
    expect((await client.query("select hours::float, rate::float from time_entries where organization_id = $1", [orgId])).rows).toEqual([
      { hours: 3, rate: 120 },
    ]);
  });
});
