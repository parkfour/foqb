import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import {
  addMember,
  asUser,
  createAccount,
  createCustomer,
  createOrg,
  createUser,
  createVendor,
} from "./helpers";

describe("recurring invoices/bills", () => {
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

  it("lets a writer create a recurring invoice + lines, blocks a viewer", async () => {
    const orgId = await createOrg(client);
    const owner = await createUser(client);
    await addMember(client, orgId, owner, "owner");
    const viewer = await createUser(client);
    await addMember(client, orgId, viewer, "viewer");
    const customerId = await createCustomer(client, orgId);
    const revenueAccount = await createAccount(client, orgId, { type: "revenue" });

    await asUser(client, owner);
    const { rows } = await client.query(
      "insert into recurring_invoices (organization_id, customer_id, frequency, next_date) values ($1, $2, 'monthly', '2026-07-01') returning id",
      [orgId, customerId],
    );
    const recurringId = rows[0].id;

    await expect(
      client.query(
        "insert into recurring_invoice_lines (recurring_invoice_id, account_id, description, quantity, unit_price) values ($1, $2, 'Retainer', 1, 500)",
        [recurringId, revenueAccount],
      ),
    ).resolves.toBeDefined();

    await client.query("RESET ROLE");
    await asUser(client, viewer);

    const { rows: visibleRows } = await client.query(
      "select id from recurring_invoices where organization_id = $1",
      [orgId],
    );
    expect(visibleRows).toHaveLength(1);

    await expect(
      client.query(
        "insert into recurring_invoices (organization_id, customer_id, frequency, next_date) values ($1, $2, 'monthly', '2026-08-01')",
        [orgId, customerId],
      ),
    ).rejects.toThrow();
  });

  it("lets a writer create a recurring bill + lines, blocks a viewer", async () => {
    const orgId = await createOrg(client);
    const owner = await createUser(client);
    await addMember(client, orgId, owner, "owner");
    const viewer = await createUser(client);
    await addMember(client, orgId, viewer, "viewer");
    const vendorId = await createVendor(client, orgId);
    const expenseAccount = await createAccount(client, orgId, { type: "expense" });

    await asUser(client, owner);
    const { rows } = await client.query(
      "insert into recurring_bills (organization_id, vendor_id, frequency, next_date) values ($1, $2, 'monthly', '2026-07-01') returning id",
      [orgId, vendorId],
    );
    const recurringId = rows[0].id;

    await expect(
      client.query(
        "insert into recurring_bill_lines (recurring_bill_id, account_id, description, quantity, unit_price) values ($1, $2, 'Rent', 1, 1200)",
        [recurringId, expenseAccount],
      ),
    ).resolves.toBeDefined();

    await client.query("RESET ROLE");
    await asUser(client, viewer);

    await expect(
      client.query(
        "insert into recurring_bills (organization_id, vendor_id, frequency, next_date) values ($1, $2, 'monthly', '2026-08-01')",
        [orgId, vendorId],
      ),
    ).rejects.toThrow();
  });
});
