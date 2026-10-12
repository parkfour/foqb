import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { addMember, asUser, createAccount, createOrg, createUser, newId } from "./helpers";

describe("items", () => {
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

  it("scopes items to organization members", async () => {
    const orgId = await createOrg(client);
    const otherOrgId = await createOrg(client);
    const member = await createUser(client);
    await addMember(client, orgId, member, "owner");

    const revenue = await createAccount(client, orgId, { type: "revenue" });
    const itemId = newId();
    await client.query(
      "insert into items (id, organization_id, name, income_account_id) values ($1, $2, 'Widget', $3)",
      [itemId, orgId, revenue],
    );

    const otherRevenue = await createAccount(client, otherOrgId, { type: "revenue" });
    await client.query(
      "insert into items (organization_id, name, income_account_id) values ($1, 'Other Widget', $2)",
      [otherOrgId, otherRevenue],
    );

    await asUser(client, member);
    const { rows } = await client.query("select id from items");
    expect(rows.map((r) => r.id)).toEqual([itemId]);
  });

  it("blocks a viewer from creating items but allows a writer", async () => {
    const orgId = await createOrg(client);
    const owner = await createUser(client, "owner@example.com");
    await addMember(client, orgId, owner, "owner");
    const viewer = await createUser(client, "viewer@example.com");
    await addMember(client, orgId, viewer, "viewer");
    const revenue = await createAccount(client, orgId, { type: "revenue" });

    await asUser(client, viewer);
    await client.query("SAVEPOINT sp1");
    await expect(
      client.query(
        "insert into items (organization_id, name, income_account_id) values ($1, 'Blocked', $2)",
        [orgId, revenue],
      ),
    ).rejects.toThrow();
    await client.query("ROLLBACK TO SAVEPOINT sp1");

    await client.query("RESET ROLE");
    await asUser(client, owner);
    await expect(
      client.query(
        "insert into items (organization_id, name, income_account_id) values ($1, 'Widget', $2)",
        [orgId, revenue],
      ),
    ).resolves.toBeDefined();
  });

  it("requires an income account", async () => {
    const orgId = await createOrg(client);

    await expect(
      client.query("insert into items (organization_id, name) values ($1, 'No Account')", [
        orgId,
      ]),
    ).rejects.toThrow();
  });

  it("links an invoice line to the item that drove it", async () => {
    const orgId = await createOrg(client);
    const customerId = newId();
    await client.query("insert into customers (id, organization_id, name) values ($1, $2, 'Acme')", [
      customerId,
      orgId,
    ]);
    const revenue = await createAccount(client, orgId, { type: "revenue" });
    const itemId = newId();
    await client.query(
      "insert into items (id, organization_id, name, income_account_id, sale_price) values ($1, $2, 'Widget', $3, 25.00)",
      [itemId, orgId, revenue],
    );

    const invoiceId = newId();
    await client.query(
      "insert into invoices (id, organization_id, customer_id, invoice_number, invoice_date) values ($1, $2, $3, 'INV-1', current_date)",
      [invoiceId, orgId, customerId],
    );
    await client.query(
      "insert into invoice_lines (invoice_id, item_id, description, account_id, quantity, unit_price, amount) values ($1, $2, 'Widget', $3, 2, 25.00, 50.00)",
      [invoiceId, itemId, revenue],
    );

    const { rows } = await client.query(
      "select item_id, amount from invoice_lines where invoice_id = $1",
      [invoiceId],
    );
    expect(rows[0].item_id).toBe(itemId);
    expect(Number(rows[0].amount)).toBe(50);
  });
});
