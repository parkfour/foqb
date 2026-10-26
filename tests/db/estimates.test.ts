import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { addMember, asUser, createAccount, createCustomer, createOrg, createUser, newId } from "./helpers";

describe("estimates (20260101000083)", () => {
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

  async function fails(sql: string, params: unknown[]): Promise<string> {
    await client.query("SAVEPOINT attempt");
    try {
      await client.query(sql, params);
      return "";
    } catch (err) {
      return (err as Error).message;
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT attempt");
    }
  }

  const insertEstimate =
    "insert into estimates (id, organization_id, customer_id, estimate_number, estimate_date) values ($1, $2, $3, $4, '2026-10-01')";
  const insertLine =
    "insert into estimate_lines (organization_id, estimate_id, account_id, quantity, unit_price) values ($1, $2, $3, 1, 100)";

  it("lets writers add estimates, refuses viewers and other books' customers and accounts", async () => {
    const org = await createOrg(client);
    const other = await createOrg(client, "Other");
    const owner = await createUser(client, "est-owner@example.com");
    const viewer = await createUser(client, "est-viewer@example.com");
    await addMember(client, org, owner, "owner");
    await addMember(client, org, viewer, "viewer");
    const customer = await createCustomer(client, org);
    const theirCustomer = await createCustomer(client, other);
    const sales = await createAccount(client, org, { name: "Sales", type: "revenue" });
    const theirSales = await createAccount(client, other, { name: "Theirs", type: "revenue" });

    await asUser(client, owner);
    const id = newId();
    await client.query(insertEstimate, [id, org, customer, "E-1"]);
    await client.query(insertLine, [org, id, sales]);
    expect(await fails(insertEstimate, [newId(), org, theirCustomer, "E-2"])).toMatch(/same organization/);
    expect(await fails(insertLine, [org, id, theirSales])).toMatch(/same organization/);
    expect(await fails("update estimates set status = 'sent' where id = $1", [id])).toMatch(/check constraint/);

    await client.query("RESET ROLE");
    await asUser(client, viewer);
    expect((await client.query("select estimate_number from estimates")).rows).toEqual([{ estimate_number: "E-1" }]);
    expect(await fails(insertEstimate, [newId(), org, customer, "E-3"])).toMatch(/row-level security/);
  });

  it("restores estimates and their lines from a backup", async () => {
    const orgId = newId();
    const sales = newId();
    const customer = newId();
    const estimate = newId();
    const snapshot = {
      organization: { id: orgId, name: "Restored Quotes" },
      accounts: [{ id: sales, organization_id: orgId, account_number: "4000", name: "Sales", type: "revenue", is_active: true }],
      customers: [{ id: customer, organization_id: orgId, name: "Ann", is_active: true }],
      estimates: [
        { id: estimate, organization_id: orgId, customer_id: customer, estimate_number: "Q-7", estimate_date: "2026-10-01",
          expiry_date: "2026-10-31", status: "accepted", tax_rate: 0, tax_rate_ids: [], notes: null, invoice_id: null,
          estimate_lines: [{ id: newId(), estimate_id: estimate, item_id: null, account_id: sales, description: "Design", quantity: 2, unit_price: 50 }] },
      ],
      journal_entries: [], invoices: [], vendors: [], bills: [], invoice_payments: [], bill_payments: [], items: [], inventory_items: [],
      fixed_assets: [], recurring_invoices: [], recurring_bills: [], bank_transactions: [], bank_reconciliations: [], categorization_rules: [],
    };

    await asUser(client, await createUser(client, "est-restorer@example.com"));
    await client.query("select restore_organization($1)", [JSON.stringify(snapshot)]);
    await client.query("RESET ROLE");

    expect((await client.query("select estimate_number, status, expiry_date::text from estimates where organization_id = $1", [orgId])).rows).toEqual([
      { estimate_number: "Q-7", status: "accepted", expiry_date: "2026-10-31" },
    ]);
    expect((await client.query("select description, quantity::text from estimate_lines where estimate_id = $1", [estimate])).rows).toEqual([
      { description: "Design", quantity: "2.00" },
    ]);
  });
});
