import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { asUser, createAccount, createOrg, createUser, newId } from "./helpers";

describe("account deletion", () => {
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

  it("allows deleting an account nothing references", async () => {
    const orgId = await createOrg(client);
    const owner = await createUser(client);
    const accountId = await createAccount(client, orgId);
    await client.query(
      "insert into organization_members (organization_id, user_id, role) values ($1, $2, 'owner')",
      [orgId, owner],
    );

    await asUser(client, owner);
    await expect(
      client.query("delete from accounts where id = $1", [accountId]),
    ).resolves.toBeDefined();
  });

  it("rejects with a foreign_key_violation when a journal line references the account", async () => {
    const orgId = await createOrg(client);
    const owner = await createUser(client);
    const accountId = await createAccount(client, orgId, { accountNumber: "1000" });
    await client.query(
      "insert into organization_members (organization_id, user_id, role) values ($1, $2, 'owner')",
      [orgId, owner],
    );

    // Status stays 'draft' — the balance-verification trigger only fires on
    // 'posted', and the FK from journal_lines to accounts doesn't care about
    // the entry's status anyway; this is only here to create the reference.
    const entryId = newId();
    await client.query(
      "insert into journal_entries (id, organization_id, entry_date, status) values ($1, $2, current_date, 'draft')",
      [entryId, orgId],
    );
    await client.query(
      "insert into journal_lines (journal_entry_id, account_id, debit, credit) values ($1, $2, 10, 0)",
      [entryId, accountId],
    );

    await asUser(client, owner);
    await expect(
      client.query("delete from accounts where id = $1", [accountId]),
    ).rejects.toMatchObject({ code: "23503" });
  });
});
