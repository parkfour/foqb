import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { asUser, createOrg, createUser, newId } from "./helpers";

describe("book currency", () => {
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

  it("starts in USD and can change to another currency code while the book is empty", async () => {
    const orgId = await createOrg(client, "Currency Org");
    const { rows } = await client.query("select currency from organizations where id = $1", [orgId]);
    expect(rows[0].currency).toBe("USD");

    await client.query("update organizations set currency = 'KRW' where id = $1", [orgId]);
    const { rows: after } = await client.query("select currency from organizations where id = $1", [orgId]);
    expect(after[0].currency).toBe("KRW");

    await expect(client.query("update organizations set currency = 'usd' where id = $1", [orgId])).rejects.toThrow(
      /check/,
    );
  });

  it("refuses a change once anything is booked", async () => {
    const orgId = await createOrg(client, "Booked Org");
    await client.query(
      "insert into journal_entries (id, organization_id, entry_date, status) values ($1, $2, current_date, 'draft')",
      [newId(), orgId],
    );

    await client.query("SAVEPOINT s");
    await expect(client.query("update organizations set currency = 'EUR' where id = $1", [orgId])).rejects.toThrow(
      /already has entries in USD/,
    );
    await client.query("ROLLBACK TO SAVEPOINT s");
  });

  it("restores a book's currency, and USD for an older backup", async () => {
    const empty = {
      accounts: [], journal_entries: [], customers: [], vendors: [], invoices: [], bills: [], invoice_payments: [],
      bill_payments: [], items: [], inventory_items: [], fixed_assets: [], recurring_invoices: [], recurring_bills: [],
      bank_transactions: [], bank_reconciliations: [], categorization_rules: [],
    };
    const won = newId();
    const old = newId();
    const user = await createUser(client, "currency-restorer@example.com");
    await asUser(client, user);
    await client.query("select restore_organization($1)", [
      JSON.stringify({ ...empty, organization: { id: won, name: "Won Book", currency: "KRW" } }),
    ]);
    await client.query("select restore_organization($1)", [
      JSON.stringify({ ...empty, organization: { id: old, name: "Old Backup" } }),
    ]);
    await client.query("RESET ROLE");

    const { rows } = await client.query("select id, currency from organizations where id = any($1)", [[won, old]]);
    expect(Object.fromEntries(rows.map((r) => [r.id, r.currency]))).toEqual({ [won]: "KRW", [old]: "USD" });
  });
});
