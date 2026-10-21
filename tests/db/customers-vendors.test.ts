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
  newId,
} from "./helpers";

describe("customers and vendors", () => {
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

  it("scopes customers and vendors to organization members", async () => {
    const orgId = await createOrg(client);
    const otherOrgId = await createOrg(client);
    const member = await createUser(client);
    await addMember(client, orgId, member, "owner");

    const customer = await createCustomer(client, orgId);
    await createCustomer(client, otherOrgId);
    const vendor = await createVendor(client, orgId);
    await createVendor(client, otherOrgId);

    await asUser(client, member);

    const { rows: customerRows } = await client.query("select id from customers");
    expect(customerRows.map((r) => r.id)).toEqual([customer]);

    const { rows: vendorRows } = await client.query("select id from vendors");
    expect(vendorRows.map((r) => r.id)).toEqual([vendor]);
  });

  it("blocks a viewer from creating customers, vendors, invoices, or bills", async () => {
    const orgId = await createOrg(client);
    const viewer = await createUser(client);
    await addMember(client, orgId, viewer, "viewer");
    const customer = await createCustomer(client, orgId);

    await asUser(client, viewer);

    await client.query("SAVEPOINT sp1");
    await expect(
      client.query("insert into customers (organization_id, name) values ($1, 'Blocked')", [
        orgId,
      ]),
    ).rejects.toThrow();
    await client.query("ROLLBACK TO SAVEPOINT sp1");

    await client.query("SAVEPOINT sp2");
    await expect(
      client.query(
        "insert into invoices (organization_id, customer_id, invoice_number, invoice_date) values ($1, $2, 'INV-1', current_date)",
        [orgId, customer],
      ),
    ).rejects.toThrow();
    await client.query("ROLLBACK TO SAVEPOINT sp2");
  });

  it("scopes invoice_lines via the parent invoice's organization", async () => {
    const orgId = await createOrg(client);
    const otherOrgId = await createOrg(client);
    const member = await createUser(client);
    await addMember(client, orgId, member, "owner");

    const customer = await createCustomer(client, orgId);
    const revenueAccount = await createAccount(client, orgId, { type: "revenue" });
    const invoiceId = newId();
    await client.query(
      "insert into invoices (id, organization_id, customer_id, invoice_number, invoice_date) values ($1, $2, $3, 'INV-1', current_date)",
      [invoiceId, orgId, customer],
    );
    await client.query(
      "insert into invoice_lines (invoice_id, description, account_id, quantity, unit_price, amount) values ($1, 'Line', $2, 1, 100, 100)",
      [invoiceId, revenueAccount],
    );

    const otherCustomer = await createCustomer(client, otherOrgId);
    const otherRevenueAccount = await createAccount(client, otherOrgId, { type: "revenue" });
    const otherInvoiceId = newId();
    await client.query(
      "insert into invoices (id, organization_id, customer_id, invoice_number, invoice_date) values ($1, $2, $3, 'INV-2', current_date)",
      [otherInvoiceId, otherOrgId, otherCustomer],
    );
    await client.query(
      "insert into invoice_lines (invoice_id, description, account_id, quantity, unit_price, amount) values ($1, 'Line', $2, 1, 50, 50)",
      [otherInvoiceId, otherRevenueAccount],
    );

    await asUser(client, member);

    const { rows } = await client.query("select invoice_id from invoice_lines");
    expect(rows.map((r) => r.invoice_id)).toEqual([invoiceId]);
  });

  it("cascades deleting an invoice to its invoice_lines", async () => {
    const orgId = await createOrg(client);
    const customer = await createCustomer(client, orgId);
    const revenueAccount = await createAccount(client, orgId, { type: "revenue" });
    const invoiceId = newId();
    await client.query(
      "insert into invoices (id, organization_id, customer_id, invoice_number, invoice_date) values ($1, $2, $3, 'INV-1', current_date)",
      [invoiceId, orgId, customer],
    );
    await client.query(
      "insert into invoice_lines (invoice_id, description, account_id, quantity, unit_price, amount) values ($1, 'Line', $2, 1, 100, 100)",
      [invoiceId, revenueAccount],
    );

    await client.query("delete from invoices where id = $1", [invoiceId]);
    const { rows } = await client.query("select id from invoice_lines where invoice_id = $1", [
      invoiceId,
    ]);
    expect(rows).toHaveLength(0);
  });

  it("rejects an invoice status outside the allowed set", async () => {
    const orgId = await createOrg(client);
    const customer = await createCustomer(client, orgId);

    await expect(
      client.query(
        "insert into invoices (organization_id, customer_id, invoice_number, invoice_date, status) values ($1, $2, 'INV-1', current_date, 'bogus')",
        [orgId, customer],
      ),
    ).rejects.toThrow();
  });

  it("rejects a non-positive invoice payment amount", async () => {
    const orgId = await createOrg(client);
    const customer = await createCustomer(client, orgId);
    const cash = await createAccount(client, orgId, { type: "asset", accountNumber: "1000" });
    const invoiceId = newId();
    await client.query(
      "insert into invoices (id, organization_id, customer_id, invoice_number, invoice_date) values ($1, $2, $3, 'INV-1', current_date)",
      [invoiceId, orgId, customer],
    );

    await expect(
      client.query(
        "insert into invoice_payments (organization_id, invoice_id, payment_date, amount, deposit_account_id) values ($1, $2, current_date, 0, $3)",
        [orgId, invoiceId, cash],
      ),
    ).rejects.toThrow();
  });

  it("posts a balanced journal entry for an invoice: Dr Accounts Receivable = Cr revenue lines", async () => {
    const orgId = await createOrg(client);
    const customer = await createCustomer(client, orgId);
    const ar = await createAccount(client, orgId, { type: "asset", accountNumber: "1200" });
    const revenueA = await createAccount(client, orgId, { type: "revenue", accountNumber: "4000" });
    const revenueB = await createAccount(client, orgId, { type: "revenue", accountNumber: "4001" });

    const entryId = newId();
    await client.query(
      "insert into journal_entries (id, organization_id, entry_date, memo, status) values ($1, $2, current_date, 'Invoice INV-1', 'draft')",
      [entryId, orgId],
    );
    await client.query(
      "insert into journal_lines (journal_entry_id, account_id, debit, credit) values ($1, $2, 150, 0)",
      [entryId, ar],
    );
    await client.query(
      "insert into journal_lines (journal_entry_id, account_id, debit, credit) values ($1, $2, 0, 100)",
      [entryId, revenueA],
    );
    await client.query(
      "insert into journal_lines (journal_entry_id, account_id, debit, credit) values ($1, $2, 0, 50)",
      [entryId, revenueB],
    );

    await expect(
      client.query("update journal_entries set status = 'posted' where id = $1", [entryId]),
    ).resolves.toBeDefined();

    const invoiceId = newId();
    await client.query(
      "insert into invoices (id, organization_id, customer_id, invoice_number, invoice_date, journal_entry_id) values ($1, $2, $3, 'INV-1', current_date, $4)",
      [invoiceId, orgId, customer, entryId],
    );
    await client.query(
      "insert into invoice_lines (invoice_id, description, account_id, quantity, unit_price, amount) values ($1, 'A', $2, 2, 50, 100), ($1, 'B', $3, 1, 50, 50)",
      [invoiceId, revenueA, revenueB],
    );

    const { rows } = await client.query(
      "select sum(amount) as total from invoice_lines where invoice_id = $1",
      [invoiceId],
    );
    expect(Number(rows[0].total)).toBe(150);
  });

  it("rejects an unbalanced journal entry for an invoice", async () => {
    const orgId = await createOrg(client);
    const ar = await createAccount(client, orgId, { type: "asset", accountNumber: "1200" });
    const revenue = await createAccount(client, orgId, { type: "revenue", accountNumber: "4000" });

    const entryId = newId();
    await client.query(
      "insert into journal_entries (id, organization_id, entry_date, memo, status) values ($1, $2, current_date, 'Invoice INV-2', 'draft')",
      [entryId, orgId],
    );
    await client.query(
      "insert into journal_lines (journal_entry_id, account_id, debit, credit) values ($1, $2, 150, 0)",
      [entryId, ar],
    );
    await client.query(
      "insert into journal_lines (journal_entry_id, account_id, debit, credit) values ($1, $2, 0, 100)",
      [entryId, revenue],
    );

    await expect(
      client.query("update journal_entries set status = 'posted' where id = $1", [entryId]),
    ).rejects.toThrow();
  });
});
