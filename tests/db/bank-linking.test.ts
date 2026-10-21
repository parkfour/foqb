import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { addMember, asUser, createOrg, createUser } from "./helpers";

describe("bank linking switches", () => {
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

  async function orgWith(role: "owner" | "accountant") {
    const orgId = await createOrg(client, "Bank Switch Org");
    const userId = await createUser(client, `${role}-banks@example.com`);
    await addMember(client, orgId, userId, role);
    return { orgId, userId };
  }

  // As the signed-in user, past two-factor (connecting a bank needs AAL2).
  async function connectBank(orgId: string, userId: string) {
    await asUser(client, userId);
    await client.query("SET LOCAL request.jwt.claim.aal = 'aal2'");
    await client.query(
      "insert into enrollments (organization_id, institution_name, access_token, external_item_id) values ($1, 'Bank', 'enc', $2)",
      [orgId, `item-${orgId}`],
    );
  }

  it("connects a bank when both switches are on", async () => {
    const { orgId, userId } = await orgWith("owner");
    await expect(connectBank(orgId, userId)).resolves.toBeUndefined();
  });

  it("refuses a new connection when the organization turned it off", async () => {
    const { orgId, userId } = await orgWith("owner");
    await client.query("update organizations set bank_linking_enabled = false where id = $1", [orgId]);

    await expect(connectBank(orgId, userId)).rejects.toThrow(/row-level security/);
  });

  it("refuses a new connection when a Site Admin turned it off everywhere", async () => {
    const { orgId, userId } = await orgWith("owner");
    await client.query("update site_settings set bank_linking_enabled = false");

    await expect(connectBank(orgId, userId)).rejects.toThrow(/row-level security/);
  });

  it("lets an owner change the organization's switch", async () => {
    const { orgId, userId } = await orgWith("owner");
    await asUser(client, userId);

    const { rowCount } = await client.query(
      "update organizations set bank_linking_enabled = false where id = $1",
      [orgId],
    );
    expect(rowCount).toBe(1);
  });

  it("doesn't let an accountant change it, though they can edit other org settings", async () => {
    const { orgId, userId } = await orgWith("accountant");
    await asUser(client, userId);

    await client.query("update organizations set inventory_enabled = true where id = $1", [orgId]);
    await expect(
      client.query("update organizations set bank_linking_enabled = false where id = $1", [orgId]),
    ).rejects.toThrow(/Only an owner/);
  });

  it("logs a Site Admin turning it off", async () => {
    const admin = await createUser(client, "banks-admin@example.com");
    await client.query("insert into site_admins (user_id) values ($1) on conflict do nothing", [admin]);
    await asUser(client, admin);
    await client.query("update site_settings set bank_linking_enabled = false");
    await client.query("RESET ROLE");

    const { rows } = await client.query("select action from site_admin_actions where site_admin_id = $1", [admin]);
    expect(rows).toEqual([{ action: "banks_off" }]);
  });
});
