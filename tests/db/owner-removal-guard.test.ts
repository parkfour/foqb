import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { addMember, asUser, createOrg, createUser } from "./helpers";

async function makeSiteAdmin(client: Client, userId: string): Promise<void> {
  await client.query("insert into site_admins (user_id) values ($1)", [userId]);
}

describe("owner-removal guard", () => {
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

  describe("set_owner_removal_secret", () => {
    it("lets an owner set it once, and reports it as set", async () => {
      const orgId = await createOrg(client);
      const owner = await createUser(client, "owner@example.com");
      await addMember(client, orgId, owner, "owner");

      await asUser(client, owner);
      await client.query("select set_owner_removal_secret($1, $2)", [orgId, "correct-horse"]);
      const { rows } = await client.query("select has_owner_removal_secret($1) as has", [orgId]);
      await client.query("RESET ROLE");

      expect(rows[0].has).toBe(true);
    });

    it("rejects a non-owner", async () => {
      const orgId = await createOrg(client);
      const accountant = await createUser(client, "accountant@example.com");
      await addMember(client, orgId, accountant, "accountant");

      await asUser(client, accountant);
      await expect(
        client.query("select set_owner_removal_secret($1, $2)", [orgId, "correct-horse"]),
      ).rejects.toThrow(/only an owner/i);
    });

    it("rejects a secret under 8 characters", async () => {
      const orgId = await createOrg(client);
      const owner = await createUser(client, "owner2@example.com");
      await addMember(client, orgId, owner, "owner");

      await asUser(client, owner);
      await expect(client.query("select set_owner_removal_secret($1, $2)", [orgId, "short"])).rejects.toThrow(
        /at least 8 characters/i,
      );
    });

    it("can't be set a second time", async () => {
      const orgId = await createOrg(client);
      const owner = await createUser(client, "owner3@example.com");
      await addMember(client, orgId, owner, "owner");

      await asUser(client, owner);
      await client.query("select set_owner_removal_secret($1, $2)", [orgId, "correct-horse"]);
      await expect(
        client.query("select set_owner_removal_secret($1, $2)", [orgId, "different-horse"]),
      ).rejects.toThrow(/already has an owner-removal secret/i);
    });
  });

  describe("removing/demoting owners", () => {
    it("does not require a secret with 3+ owners", async () => {
      const orgId = await createOrg(client);
      const owner1 = await createUser(client, "o1@example.com");
      const owner2 = await createUser(client, "o2@example.com");
      const owner3 = await createUser(client, "o3@example.com");
      await addMember(client, orgId, owner1, "owner");
      const memberId2 = await addMemberReturningId(client, orgId, owner2, "owner");
      await addMember(client, orgId, owner3, "owner");

      await asUser(client, owner1);
      await client.query("select remove_org_member_guarded($1)", [memberId2]);

      const { rows } = await client.query(
        "select count(*)::int as n from organization_members where organization_id = $1 and role = 'owner'",
        [orgId],
      );
      expect(rows[0].n).toBe(2);
    });

    it("blocks removing the last owner when no secret is set", async () => {
      const orgId = await createOrg(client);
      const owner = await createUser(client, "solo-owner@example.com");
      const memberId = await addMemberReturningId(client, orgId, owner, "owner");

      await asUser(client, owner);
      await expect(client.query("select remove_org_member_guarded($1)", [memberId])).rejects.toThrow(
        /no owner-removal secret set/i,
      );
    });

    it("blocks removing the second-to-last owner with the wrong secret", async () => {
      const orgId = await createOrg(client);
      const owner1 = await createUser(client, "owner-a@example.com");
      const owner2 = await createUser(client, "owner-b@example.com");
      await addMember(client, orgId, owner1, "owner");
      const memberId2 = await addMemberReturningId(client, orgId, owner2, "owner");

      await asUser(client, owner1);
      await client.query("select set_owner_removal_secret($1, $2)", [orgId, "correct-horse"]);
      await expect(
        client.query("select remove_org_member_guarded($1, $2)", [memberId2, "wrong-secret"]),
      ).rejects.toThrow(/incorrect owner-removal secret/i);
    });

    it("allows removing the last owner with the correct secret", async () => {
      const orgId = await createOrg(client);
      const owner = await createUser(client, "solo-owner-2@example.com");
      const memberId = await addMemberReturningId(client, orgId, owner, "owner");

      await asUser(client, owner);
      await client.query("select set_owner_removal_secret($1, $2)", [orgId, "correct-horse"]);
      await client.query("select remove_org_member_guarded($1, $2)", [memberId, "correct-horse"]);

      const { rows } = await client.query("select count(*)::int as n from organization_members where organization_id = $1", [
        orgId,
      ]);
      expect(rows[0].n).toBe(0);
    });

    it("blocks demoting the second-to-last owner without the secret", async () => {
      const orgId = await createOrg(client);
      const owner1 = await createUser(client, "owner-c@example.com");
      const owner2 = await createUser(client, "owner-d@example.com");
      await addMember(client, orgId, owner1, "owner");
      const memberId2 = await addMemberReturningId(client, orgId, owner2, "owner");

      await asUser(client, owner1);
      await client.query("select set_owner_removal_secret($1, $2)", [orgId, "correct-horse"]);
      await expect(
        client.query("select update_org_member_role_guarded($1, 'accountant')", [memberId2]),
      ).rejects.toThrow(/incorrect owner-removal secret/i);
    });

    it("allows demoting with the correct secret", async () => {
      const orgId = await createOrg(client);
      const owner1 = await createUser(client, "owner-e@example.com");
      const owner2 = await createUser(client, "owner-f@example.com");
      await addMember(client, orgId, owner1, "owner");
      const memberId2 = await addMemberReturningId(client, orgId, owner2, "owner");

      await asUser(client, owner1);
      await client.query("select set_owner_removal_secret($1, $2)", [orgId, "correct-horse"]);
      await client.query("select update_org_member_role_guarded($1, 'accountant', $2)", [
        memberId2,
        "correct-horse",
      ]);

      const { rows } = await client.query("select role from organization_members where id = $1", [memberId2]);
      expect(rows[0].role).toBe("accountant");
    });

    it("a non-owner change (viewer <-> accountant) never needs a secret", async () => {
      const orgId = await createOrg(client);
      const owner = await createUser(client, "owner-g@example.com");
      const viewer = await createUser(client, "viewer-a@example.com");
      await addMember(client, orgId, owner, "owner");
      const memberId = await addMemberReturningId(client, orgId, viewer, "viewer");

      await asUser(client, owner);
      await client.query("select update_org_member_role_guarded($1, 'accountant')", [memberId]);

      const { rows } = await client.query("select role from organization_members where id = $1", [memberId]);
      expect(rows[0].role).toBe("accountant");
    });
  });

  it("delete_organization removes a sole owner without needing the secret", async () => {
    const orgId = await createOrg(client, "Solo-Owner Org");
    const owner = await createUser(client, "solo-owner-3@example.com");
    await addMember(client, orgId, owner, "owner");
    const admin = await createUser(client, "guard-admin@example.com");
    await makeSiteAdmin(client, admin);

    await asUser(client, admin);
    await client.query("select delete_organization($1)", [orgId]);
    await client.query("RESET ROLE");

    const { rows } = await client.query("select id from organizations where id = $1", [orgId]);
    expect(rows).toHaveLength(0);
  });

  // Reproduces the real failure: Supabase's Auth admin API / dashboard
  // deleting a user cascades to their organization_members row via FK —
  // without this bypass, deleting the sole owner of a secret-less org
  // (e.g. an interrupted test signup) failed with an opaque "Database
  // error deleting user".
  it("deleting a user (cascading to their sole-owner membership) doesn't need the secret", async () => {
    const orgId = await createOrg(client, "Interrupted Signup Org");
    const owner = await createUser(client, "interrupted-signup@example.com");
    await addMember(client, orgId, owner, "owner");

    await expect(client.query("delete from auth.users where id = $1", [owner])).resolves.toBeDefined();

    const { rows } = await client.query(
      "select id from organization_members where organization_id = $1",
      [orgId],
    );
    expect(rows).toHaveLength(0);
  });
});

async function addMemberReturningId(
  client: Client,
  orgId: string,
  userId: string,
  role: "owner" | "accountant" | "viewer",
): Promise<string> {
  const { rows } = await client.query(
    "insert into organization_members (organization_id, user_id, role) values ($1, $2, $3) returning id",
    [orgId, userId, role],
  );
  return rows[0].id as string;
}
