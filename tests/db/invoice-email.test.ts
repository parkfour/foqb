import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { addMember, asUser, createCustomer, createOrg, createUser, newId } from "./helpers";

describe("invoice email", () => {
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

  async function refused(sql: string, params: unknown[], pattern: RegExp) {
    await client.query("SAVEPOINT s");
    await expect(client.query(sql, params)).rejects.toThrow(pattern);
    await client.query("ROLLBACK TO SAVEPOINT s");
  }

  async function setup() {
    const orgId = await createOrg(client, "Mail Org");
    const owner = await createUser(client, "mail-owner@example.com");
    const accountant = await createUser(client, "mail-accountant@example.com");
    await addMember(client, orgId, owner, "owner");
    await addMember(client, orgId, accountant, "accountant");
    const customerId = await createCustomer(client, orgId);
    const invoiceId = newId();
    await client.query(
      "insert into invoices (id, organization_id, customer_id, invoice_number, invoice_date) values ($1, $2, $3, 'INV-1', current_date)",
      [invoiceId, orgId, customerId],
    );
    return { orgId, owner, accountant, invoiceId };
  }

  const insertServer =
    "insert into organization_smtp_settings (organization_id, host, port, username, password_encrypted, from_address) values ($1, 'smtp.example.com', 587, 'u', 'encrypted', 'a@example.com')";

  it("lets an owner set up a mail server, but no signed-in user read its password", async () => {
    const { orgId, owner, accountant } = await setup();

    await asUser(client, owner);
    await client.query(insertServer, [orgId]);
    await refused("select password_encrypted from organization_smtp_settings", [], /permission denied/);
    await client.query("RESET ROLE");

    await asUser(client, accountant);
    const { rows } = await client.query("select host, from_address from organization_smtp_settings where organization_id = $1", [orgId]);
    expect(rows).toEqual([{ host: "smtp.example.com", from_address: "a@example.com" }]);
    await refused("select * from organization_smtp_settings", [], /permission denied/);
  });

  it("refuses a mail server from anyone but an owner", async () => {
    const { orgId, accountant } = await setup();
    await asUser(client, accountant);
    await refused(insertServer, [orgId], /row-level security/);
  });

  it("records a sent invoice in the audit log, only as the sender", async () => {
    const { orgId, owner, accountant, invoiceId } = await setup();
    await asUser(client, accountant);

    await refused(
      "insert into invoice_emails (organization_id, invoice_id, sent_to, subject, sent_by) values ($1, $2, 'c@example.com', 'Invoice', $3)",
      [orgId, invoiceId, owner],
      /row-level security/,
    );
    const { rows } = await client.query(
      "insert into invoice_emails (organization_id, invoice_id, sent_to, subject) values ($1, $2, 'c@example.com', 'Invoice INV-1') returning id, sent_by",
      [orgId, invoiceId],
    );
    expect(rows[0].sent_by).toBe(accountant);

    await client.query("RESET ROLE");
    const audit = await client.query("select action, changed_by from audit_log where table_name = 'invoice_emails' and row_id = $1", [rows[0].id]);
    expect(audit.rows).toEqual([{ action: "insert", changed_by: accountant }]);
  });

  it("refuses an invoice from another organization", async () => {
    const { accountant, invoiceId } = await setup();
    const otherOrg = await createOrg(client, "Other Org");
    await addMember(client, otherOrg, accountant, "accountant");
    await asUser(client, accountant);

    await refused(
      "insert into invoice_emails (organization_id, invoice_id, sent_to, subject) values ($1, $2, 'c@example.com', 'Invoice')",
      [otherOrg, invoiceId],
      /organization/i,
    );
  });

  it("keeps the record when the sender's account is deleted", async () => {
    const { orgId, accountant, invoiceId } = await setup();
    await asUser(client, accountant);
    const { rows } = await client.query(
      "insert into invoice_emails (organization_id, invoice_id, sent_to, subject) values ($1, $2, 'c@example.com', 'Invoice') returning id",
      [orgId, invoiceId],
    );
    // Accounts are deleted through the admin API, with no one signed in.
    await client.query("RESET ROLE");
    await client.query("SET LOCAL request.jwt.claim.sub = ''");

    await client.query("delete from auth.users where id = $1", [accountant]);
    const after = await client.query("select sent_by from invoice_emails where id = $1", [rows[0].id]);
    expect(after.rows).toEqual([{ sent_by: null }]);
  });
});
