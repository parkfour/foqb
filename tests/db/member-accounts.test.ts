import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { addMember, asUser, createOrg, createUser } from "./helpers";

describe("owner-created member accounts", () => {
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

  it("blocks self-insert into organization_members once the org already has a member", async () => {
    const orgId = await createOrg(client);
    const owner = await createUser(client);
    await addMember(client, orgId, owner, "owner");
    const outsider = await createUser(client);

    await asUser(client, outsider);
    await expect(
      client.query(
        "insert into organization_members (organization_id, user_id, role) values ($1, $2, 'owner')",
        [orgId, outsider],
      ),
    ).rejects.toThrow();
  });

  it("is_org_owner is true only for an owner, not an accountant or viewer", async () => {
    const orgId = await createOrg(client);
    const owner = await createUser(client);
    await addMember(client, orgId, owner, "owner");
    const accountant = await createUser(client, "accountant@example.com");
    await addMember(client, orgId, accountant, "accountant");
    const viewer = await createUser(client, "viewer@example.com");
    await addMember(client, orgId, viewer, "viewer");

    await asUser(client, owner);
    const { rows: ownerRows } = await client.query("select is_org_owner($1) as v", [orgId]);
    expect(ownerRows[0].v).toBe(true);

    await client.query("RESET ROLE");
    await asUser(client, accountant);
    const { rows: accountantRows } = await client.query("select is_org_owner($1) as v", [orgId]);
    expect(accountantRows[0].v).toBe(false);

    await client.query("RESET ROLE");
    await asUser(client, viewer);
    const { rows: viewerRows } = await client.query("select is_org_owner($1) as v", [orgId]);
    expect(viewerRows[0].v).toBe(false);
  });

  it("get_org_members reports has_logged_in from auth.users.last_sign_in_at", async () => {
    const orgId = await createOrg(client);
    const owner = await createUser(client);
    await addMember(client, orgId, owner, "owner");
    const pending = await createUser(client, "pending@example.com");
    await addMember(client, orgId, pending, "accountant");
    await client.query("update auth.users set last_sign_in_at = now() where id = $1", [owner]);

    await asUser(client, owner);
    const { rows } = await client.query(
      "select email, has_logged_in from get_org_members($1) order by email",
      [orgId],
    );

    expect(rows).toEqual([
      { email: "pending@example.com", has_logged_in: false },
      { email: "test@example.com", has_logged_in: true },
    ]);
  });

  it("locks pending_member_accounts to the service role — no policy grants access", async () => {
    const orgId = await createOrg(client);
    const owner = await createUser(client);
    await addMember(client, orgId, owner, "owner");
    const newMember = await createUser(client, "new@example.com");
    await addMember(client, orgId, newMember, "accountant");

    // Inserted as the unrestricted test-setup role (stands in for the
    // service-role admin client, which bypasses RLS entirely in the real app).
    const { rows: insertRows } = await client.query(
      "insert into pending_member_accounts (organization_id, user_id, created_by) values ($1, $2, $3) returning id",
      [orgId, newMember, owner],
    );
    const pendingId = insertRows[0].id;

    await asUser(client, owner);
    // No policies exist for authenticated/anon — even the owner who created
    // this pending account can't see it through the normal RLS-scoped client.
    const { rows: selectRows } = await client.query(
      "select id from pending_member_accounts where id = $1",
      [pendingId],
    );
    expect(selectRows).toHaveLength(0);

    await expect(
      client.query("delete from pending_member_accounts where id = $1", [pendingId]),
    ).resolves.toBeDefined();
    // A no-op delete (blocked by RLS, not an error) — confirm nothing changed.
    await client.query("RESET ROLE");
    const { rows: stillThere } = await client.query(
      "select id from pending_member_accounts where id = $1",
      [pendingId],
    );
    expect(stillThere).toHaveLength(1);
  });
});
