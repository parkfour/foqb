import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { addMember, asUser, createAccount, createCustomer, createOrg, createUser, newId } from "./helpers";

describe("same-org reference guard", () => {
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

  async function draftEntry(orgId: string): Promise<string> {
    const id = newId();
    await client.query(
      "insert into journal_entries (id, organization_id, entry_date, status) values ($1, $2, current_date, 'draft')",
      [id, orgId],
    );
    return id;
  }

  it("rejects a writer posting a journal line against another org's account", async () => {
    const orgA = await createOrg(client, "A");
    const orgB = await createOrg(client, "B");
    const writer = await createUser(client, "writer@example.com");
    await addMember(client, orgA, writer, "accountant");
    const foreignAccount = await createAccount(client, orgB);
    const entry = await draftEntry(orgA);

    await asUser(client, writer);
    await expect(
      client.query(
        "insert into journal_lines (journal_entry_id, account_id, debit, credit) values ($1, $2, 10, 0)",
        [entry, foreignAccount],
      ),
    ).rejects.toThrow(/same organization/);
  });

  it("allows a journal line against the org's own account", async () => {
    const orgA = await createOrg(client, "A");
    const writer = await createUser(client, "writer@example.com");
    await addMember(client, orgA, writer, "accountant");
    const ownAccount = await createAccount(client, orgA);
    const entry = await draftEntry(orgA);

    await asUser(client, writer);
    await client.query(
      "insert into journal_lines (journal_entry_id, account_id, debit, credit) values ($1, $2, 10, 0)",
      [entry, ownAccount],
    );
  });

  it("rejects an invoice for another org's customer, even from the service role", async () => {
    const orgA = await createOrg(client, "A");
    const orgB = await createOrg(client, "B");
    const foreignCustomer = await createCustomer(client, orgB);

    await expect(
      client.query(
        "insert into invoices (organization_id, customer_id, invoice_number, invoice_date, due_date) values ($1, $2, 'INV-1', current_date, current_date)",
        [orgA, foreignCustomer],
      ),
    ).rejects.toThrow(/same organization/);
  });

  it("rejects a restored backup whose lines reference another org's account", async () => {
    const victimOrg = await createOrg(client, "Victim");
    const victimAccount = await createAccount(client, victimOrg);
    const newOrgId = newId();
    const snapshot = {
      organization: { id: newOrgId, name: "Attacker" },
      accounts: [],
      journal_entries: [
        {
          id: newId(),
          entry_date: "2026-01-01",
          status: "draft",
          created_at: "2026-01-01T00:00:00Z",
          journal_lines: [{ id: newId(), account_id: victimAccount, debit: 5, credit: 0 }],
        },
      ],
    };

    const attacker = await createUser(client, "attacker@example.com");
    await asUser(client, attacker);
    await expect(
      client.query("select restore_organization($1)", [JSON.stringify(snapshot)]),
    ).rejects.toThrow(/same organization/);
  });
});
