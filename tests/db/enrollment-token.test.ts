import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { addMember, asUser, createOrg, createUser } from "./helpers";

describe("enrollments.access_token visibility", () => {
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

  async function enrolledOwner() {
    const orgId = await createOrg(client);
    const owner = await createUser(client, "owner@example.com");
    await addMember(client, orgId, owner, "owner");
    await client.query(
      "insert into enrollments (organization_id, external_item_id, access_token, institution_name) values ($1, 'item-1', 'ciphertext', 'Bank')",
      [orgId],
    );
    return { orgId, owner };
  }

  it("lets a member list enrollments without the access token", async () => {
    const { orgId, owner } = await enrolledOwner();
    await asUser(client, owner);

    const { rows } = await client.query(
      "select institution_name, status from enrollments where organization_id = $1",
      [orgId],
    );
    expect(rows).toEqual([{ institution_name: "Bank", status: "active" }]);
  });

  it("refuses to return the access token to a signed-in user", async () => {
    const { owner } = await enrolledOwner();
    await asUser(client, owner);

    await expect(client.query("select access_token from enrollments")).rejects.toThrow(/permission denied/);
  });

  it("still lets a writer disconnect an enrollment", async () => {
    const { orgId, owner } = await enrolledOwner();
    await asUser(client, owner);

    const { rowCount } = await client.query(
      "update enrollments set status = 'disconnected' where organization_id = $1",
      [orgId],
    );
    expect(rowCount).toBe(1);
  });

  it("accepts the 'expiring' status and still rejects unknown ones", async () => {
    const { orgId } = await enrolledOwner();

    await client.query("update enrollments set status = 'expiring' where organization_id = $1", [orgId]);
    await expect(
      client.query("update enrollments set status = 'bogus' where organization_id = $1", [orgId]),
    ).rejects.toThrow(/enrollments_status_check/);
  });

  it("lets a member read the duplicate-guard columns", async () => {
    const { orgId, owner } = await enrolledOwner();
    await client.query(
      "update enrollments set institution_id = 'ins_3', account_masks = '{1234}' where organization_id = $1",
      [orgId],
    );
    await asUser(client, owner);

    const { rows } = await client.query("select institution_id, account_masks from enrollments where organization_id = $1", [orgId]);
    expect(rows).toEqual([{ institution_id: "ins_3", account_masks: ["1234"] }]);
  });

  it("only lets a session that completed two-factor save a new bank connection", async () => {
    const { orgId, owner } = await enrolledOwner();
    await client.query("insert into auth.mfa_factors (user_id, status) values ($1, 'verified')", [owner]);
    await asUser(client, owner);
    await client.query("SET LOCAL request.jwt.claim.aal = 'aal2'");

    await client.query(
      "insert into enrollments (organization_id, external_item_id, access_token) values ($1, 'item-2', 'ciphertext')",
      [orgId],
    );
  });

  it("refuses a new bank connection from a session without two-factor", async () => {
    const { orgId, owner } = await enrolledOwner();
    await asUser(client, owner);

    await expect(
      client.query(
        "insert into enrollments (organization_id, external_item_id, access_token) values ($1, 'item-3', 'ciphertext')",
        [orgId],
      ),
    ).rejects.toThrow(/row-level security/);
  });
});
