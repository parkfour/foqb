import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { asUser, createUser, newId } from "./helpers";

describe("other assets (20260101000098)", () => {
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

  it("restores each property's kind, and takes a backup from before it as real estate", async () => {
    const orgId = newId();
    const [home, coins] = [newId(), newId()];
    const snapshot = {
      organization: { id: orgId, name: "Restored Assets", workspace_type: "household" },
      accounts: [],
      properties: [
        { id: home, name: "Home", purchase_price: 300000, estimated_value: 400000 },
        { id: coins, name: "Coin collection", kind: "other", estimated_value: 12000 },
      ],
      customers: [], vendors: [], invoices: [], bills: [], invoice_payments: [], bill_payments: [], items: [], inventory_items: [],
      fixed_assets: [], recurring_invoices: [], recurring_bills: [], bank_transactions: [], bank_reconciliations: [], categorization_rules: [],
      journal_entries: [],
    };
    await asUser(client, await createUser(client, "assets-restorer@example.com"));
    await client.query("select restore_organization($1)", [JSON.stringify(snapshot)]);
    await client.query("RESET ROLE");
    expect((await client.query("select name, kind from properties where id = any($1) order by name", [[home, coins]])).rows).toEqual([
      { name: "Coin collection", kind: "other" },
      { name: "Home", kind: "real_estate" },
    ]);
  });

  it("allows only the two kinds", async () => {
    await expect(
      client.query("insert into properties (organization_id, name, kind) values ($1, 'x', 'car')", [newId()]),
    ).rejects.toThrow();
  });
});
