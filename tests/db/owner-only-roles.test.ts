import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { addMember, asUser, createOrg, createUser } from "./helpers";

describe("only owners change roles or add members", () => {
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

  async function orgWithAccountant() {
    const orgId = await createOrg(client, "Roles Org");
    const owner = await createUser(client, "roles-owner@example.com");
    const accountant = await createUser(client, "roles-accountant@example.com");
    await addMember(client, orgId, owner, "owner");
    await addMember(client, orgId, accountant, "accountant");
    const { rows } = await client.query(
      "select id from organization_members where organization_id = $1 and user_id = $2",
      [orgId, accountant],
    );
    return { orgId, owner, accountant, accountantMemberId: rows[0].id as string };
  }

  it("refuses an accountant promoting themselves through the role function", async () => {
    const { accountant, accountantMemberId } = await orgWithAccountant();
    await asUser(client, accountant);

    await expect(
      client.query("select update_org_member_role_guarded($1, 'owner')", [accountantMemberId]),
    ).rejects.toThrow(/only an owner/i);
  });

  it("refuses an accountant changing roles directly through the database API", async () => {
    const { accountant, accountantMemberId } = await orgWithAccountant();
    await asUser(client, accountant);

    const { rowCount } = await client.query("update organization_members set role = 'owner' where id = $1", [
      accountantMemberId,
    ]);
    expect(rowCount).toBe(0);
  });

  it("refuses an accountant adding someone, as owner or otherwise", async () => {
    const { orgId, accountant } = await orgWithAccountant();
    const outsider = await createUser(client, "roles-outsider@example.com");
    await asUser(client, accountant);

    for (const role of ["owner", "viewer"]) {
      await client.query("SAVEPOINT s");
      await expect(
        client.query("insert into organization_members (organization_id, user_id, role) values ($1, $2, $3)", [
          orgId,
          outsider,
          role,
        ]),
      ).rejects.toThrow(/row-level security/);
      await client.query("ROLLBACK TO SAVEPOINT s");
    }
  });

  it("still lets an owner change roles and add members", async () => {
    const { orgId, owner, accountantMemberId } = await orgWithAccountant();
    const newcomer = await createUser(client, "roles-newcomer@example.com");
    await asUser(client, owner);

    await client.query("select update_org_member_role_guarded($1, 'viewer')", [accountantMemberId]);
    await client.query("insert into organization_members (organization_id, user_id, role) values ($1, $2, 'viewer')", [
      orgId,
      newcomer,
    ]);

    const { rows } = await client.query("select role from organization_members where id = $1", [accountantMemberId]);
    expect(rows[0].role).toBe("viewer");
  });

  it("still lets the creator of a new organization join it as its first owner", async () => {
    const orgId = await createOrg(client, "Brand New Org");
    const creator = await createUser(client, "roles-creator@example.com");
    await asUser(client, creator);

    await client.query("insert into organization_members (organization_id, user_id, role) values ($1, $2, 'owner')", [
      orgId,
      creator,
    ]);
  });
});
