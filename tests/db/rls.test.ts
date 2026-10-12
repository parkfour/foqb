import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { addMember, asUser, createAccount, createOrg, createUser, newId } from "./helpers";

describe("row level security", () => {
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

  it("only returns organizations the user is a member of", async () => {
    const orgA = await createOrg(client, "Org A");
    const orgB = await createOrg(client, "Org B");
    const user = await createUser(client);
    await addMember(client, orgA, user);

    await asUser(client, user);
    const { rows } = await client.query("select id from organizations");
    expect(rows.map((r) => r.id)).toEqual([orgA]);
    expect(rows.map((r) => r.id)).not.toContain(orgB);
  });

  it("scopes accounts to the caller's organization", async () => {
    const orgA = await createOrg(client);
    const orgB = await createOrg(client);
    const user = await createUser(client);
    await addMember(client, orgA, user);
    const accountA = await createAccount(client, orgA);
    await createAccount(client, orgB);

    await asUser(client, user);
    const { rows } = await client.query("select id from accounts");
    expect(rows.map((r) => r.id)).toEqual([accountA]);
  });

  it("prevents inserting accounts into an organization the user does not belong to", async () => {
    const orgB = await createOrg(client);
    const user = await createUser(client);
    // user belongs to no organization

    await asUser(client, user);
    await expect(
      client.query(
        "insert into accounts (organization_id, account_number, name, type) values ($1, '9999', 'Sneaky', 'asset')",
        [orgB],
      ),
    ).rejects.toThrow();
  });

  it("scopes journal_lines via the parent journal entry's organization", async () => {
    const orgA = await createOrg(client);
    const orgB = await createOrg(client);
    const user = await createUser(client);
    await addMember(client, orgA, user);

    const accountA = await createAccount(client, orgA);
    const entryA = newId();
    await client.query(
      "insert into journal_entries (id, organization_id, entry_date, status) values ($1, $2, current_date, 'draft')",
      [entryA, orgA],
    );
    const lineA = newId();
    await client.query(
      "insert into journal_lines (id, journal_entry_id, account_id, debit, credit) values ($1, $2, $3, 10, 0)",
      [lineA, entryA, accountA],
    );

    const accountB = await createAccount(client, orgB);
    const entryB = newId();
    await client.query(
      "insert into journal_entries (id, organization_id, entry_date, status) values ($1, $2, current_date, 'draft')",
      [entryB, orgB],
    );
    await client.query(
      "insert into journal_lines (journal_entry_id, account_id, debit, credit) values ($1, $2, 10, 0)",
      [entryB, accountB],
    );

    await asUser(client, user);
    const { rows } = await client.query("select id from journal_lines");
    expect(rows.map((r) => r.id)).toEqual([lineA]);
  });

  it("scopes organization_members to the caller's organizations", async () => {
    const orgA = await createOrg(client);
    const orgB = await createOrg(client);
    const userA = await createUser(client, "a@example.com");
    const userB = await createUser(client, "b@example.com");
    await addMember(client, orgA, userA);
    await addMember(client, orgB, userB);

    await asUser(client, userA);
    const { rows } = await client.query("select user_id from organization_members");
    expect(rows.map((r) => r.user_id)).toEqual([userA]);
  });

  it("scopes enrollments and categorization_rules to the caller's organization", async () => {
    const orgA = await createOrg(client);
    const orgB = await createOrg(client);
    const user = await createUser(client);
    await addMember(client, orgA, user);

    await client.query(
      "insert into enrollments (organization_id, external_item_id, access_token) values ($1, 'enr_a', 'tok_a')",
      [orgA],
    );
    await client.query(
      "insert into enrollments (organization_id, external_item_id, access_token) values ($1, 'enr_b', 'tok_b')",
      [orgB],
    );

    const accountA = await createAccount(client, orgA);
    await client.query(
      "insert into categorization_rules (organization_id, target_account_id, rule_name, match_type, match_text) values ($1, $2, 'Rule A', 'contains', 'X')",
      [orgA, accountA],
    );
    const accountB = await createAccount(client, orgB);
    await client.query(
      "insert into categorization_rules (organization_id, target_account_id, rule_name, match_type, match_text) values ($1, $2, 'Rule B', 'contains', 'Y')",
      [orgB, accountB],
    );

    await asUser(client, user);

    const enrollments = await client.query("select external_item_id from enrollments");
    expect(enrollments.rows.map((r) => r.external_item_id)).toEqual(["enr_a"]);

    const rules = await client.query("select rule_name from categorization_rules");
    expect(rules.rows.map((r) => r.rule_name)).toEqual(["Rule A"]);
  });
});
