import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { asUser, createUser, newId } from "./helpers";

describe("1099 vendors (20260101000076)", () => {
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

  it("keeps the 1099 mark through a backup, and an older backup's vendors restore unmarked", async () => {
    const orgId = newId();
    const contractor = newId();
    const older = newId();
    const snapshot = {
      organization: { id: orgId, name: "Restored Shop" },
      accounts: [], journal_entries: [], customers: [], invoices: [], bills: [], invoice_payments: [],
      bill_payments: [], items: [], inventory_items: [], fixed_assets: [], recurring_invoices: [],
      recurring_bills: [], bank_transactions: [], bank_reconciliations: [], categorization_rules: [],
      vendors: [
        { id: contractor, organization_id: orgId, name: "Pat Plumbing", is_active: true, is_1099: true },
        { id: older, organization_id: orgId, name: "Office Store", is_active: true },
      ],
    };

    await asUser(client, await createUser(client, "restorer-1099@example.com"));
    await client.query("select restore_organization($1)", [JSON.stringify(snapshot)]);
    await client.query("RESET ROLE");

    const { rows } = await client.query("select id, is_1099 from vendors where organization_id = $1 order by name", [orgId]);
    expect(rows).toEqual([
      { id: older, is_1099: false },
      { id: contractor, is_1099: true },
    ]);
  });
});
