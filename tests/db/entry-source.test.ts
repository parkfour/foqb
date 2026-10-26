import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { asUser, createOrg, createUser, newId } from "./helpers";

describe("entry source and external id (20260101000091)", () => {
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

  const insert =
    "insert into journal_entries (organization_id, entry_date, status, source, external_id) values ($1, '2026-10-01', 'draft', $2, $3)";

  it("allows one entry per book, source and id, and an id only with a source", async () => {
    const org = await createOrg(client);
    const other = await createOrg(client, "Other");
    await client.query(insert, [org, "csv-import", "abc"]);
    await client.query(insert, [other, "csv-import", "abc"]);
    await client.query(insert, [org, "pos", "abc"]);
    for (const [source, id, message] of [["csv-import", "abc", /duplicate key/], [null, "abc", /external_needs_source/]] as const) {
      await client.query("SAVEPOINT s");
      await expect(client.query(insert, [org, source, id])).rejects.toThrow(message);
      await client.query("ROLLBACK TO SAVEPOINT s");
    }
  });

  it("restores each entry's source and id", async () => {
    const orgId = newId();
    const entry = newId();
    const snapshot = {
      organization: { id: orgId, name: "Restored Imports" },
      journal_entries: [{ id: entry, organization_id: orgId, entry_date: "2026-10-01", memo: "x", status: "draft", source: "csv-import", external_id: "abc", journal_lines: [] }],
      accounts: [], customers: [], vendors: [], invoices: [], bills: [], invoice_payments: [], bill_payments: [], items: [],
      inventory_items: [], fixed_assets: [], recurring_invoices: [], recurring_bills: [], bank_transactions: [], bank_reconciliations: [],
      categorization_rules: [],
    };
    await asUser(client, await createUser(client, "source-restorer@example.com"));
    await client.query("select restore_organization($1)", [JSON.stringify(snapshot)]);
    await client.query("RESET ROLE");
    expect((await client.query("select source, external_id from journal_entries where id = $1", [entry])).rows).toEqual([
      { source: "csv-import", external_id: "abc" },
    ]);
  });
});
