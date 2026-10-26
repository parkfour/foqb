import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { addMember, asUser, createOrg, createUser, newId } from "./helpers";

describe("mileage trips (20260101000087)", () => {
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

  const insert = "insert into mileage_trips (organization_id, trip_date, miles, rate, purpose) values ($1, '2026-10-01', $2, 0.76, $3)";

  it("lets writers log trips, refuses viewers, and needs miles and a purpose", async () => {
    const org = await createOrg(client);
    const owner = await createUser(client, "miles-owner@example.com");
    const viewer = await createUser(client, "miles-viewer@example.com");
    await addMember(client, org, owner, "owner");
    await addMember(client, org, viewer, "viewer");

    await asUser(client, owner);
    await client.query(insert, [org, 12.5, "Client visit"]);
    for (const [miles, purpose, message] of [[0, "x", /check constraint/], [5, " ", /check constraint/]] as const) {
      await client.query("SAVEPOINT s");
      await expect(client.query(insert, [org, miles, purpose])).rejects.toThrow(message);
      await client.query("ROLLBACK TO SAVEPOINT s");
    }

    await client.query("RESET ROLE");
    await asUser(client, viewer);
    expect((await client.query("select purpose from mileage_trips")).rows).toEqual([{ purpose: "Client visit" }]);
    await client.query("SAVEPOINT s");
    await expect(client.query(insert, [org, 3, "Bank"])).rejects.toThrow(/row-level security/);
    await client.query("ROLLBACK TO SAVEPOINT s");
  });

  it("restores trips from a backup", async () => {
    const orgId = newId();
    const snapshot = {
      organization: { id: orgId, name: "Restored Miles" },
      mileage_trips: [{ id: newId(), trip_date: "2026-03-02", miles: 40, rate: 0.725, purpose: "Supplier", vehicle: "Van" }],
      accounts: [], journal_entries: [], customers: [], vendors: [], invoices: [], bills: [], invoice_payments: [], bill_payments: [],
      items: [], inventory_items: [], fixed_assets: [], recurring_invoices: [], recurring_bills: [], bank_transactions: [],
      bank_reconciliations: [], categorization_rules: [],
    };
    await asUser(client, await createUser(client, "miles-restorer@example.com"));
    await client.query("select restore_organization($1)", [JSON.stringify(snapshot)]);
    await client.query("RESET ROLE");
    expect((await client.query("select miles::float, rate::float, vehicle from mileage_trips where organization_id = $1", [orgId])).rows).toEqual([
      { miles: 40, rate: 0.725, vehicle: "Van" },
    ]);
  });
});
