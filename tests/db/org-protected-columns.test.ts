import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { addMember, asUser, createOrg, createUser } from "./helpers";

describe("organization columns writers can't change directly", () => {
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

  async function org() {
    const orgId = await createOrg(client, "Protected Org");
    const owner = await createUser(client, "protected-owner@example.com");
    const accountant = await createUser(client, "protected-accountant@example.com");
    await addMember(client, orgId, owner, "owner");
    await addMember(client, orgId, accountant, "accountant");
    return { orgId, owner, accountant };
  }

  async function refused(sql: string, params: unknown[], pattern: RegExp) {
    await client.query("SAVEPOINT s");
    await expect(client.query(sql, params)).rejects.toThrow(pattern);
    await client.query("ROLLBACK TO SAVEPOINT s");
  }

  it("refuses setting or overwriting the owner-removal secret hash directly", async () => {
    const { orgId, owner, accountant } = await org();

    await asUser(client, accountant);
    await refused("update organizations set owner_removal_secret_hash = 'x' where id = $1", [orgId], /owner-removal secret/);

    await client.query("RESET ROLE");
    await asUser(client, owner);
    await client.query("select set_owner_removal_secret($1, 'correct-horse')", [orgId]);
    await refused("update organizations set owner_removal_secret_hash = null where id = $1", [orgId], /owner-removal secret/);
  });

  it("still lets set_owner_removal_secret set it once, and refuses a second time", async () => {
    const { orgId, owner } = await org();
    await asUser(client, owner);

    await client.query("select set_owner_removal_secret($1, 'correct-horse')", [orgId]);
    await refused("select set_owner_removal_secret($1, 'another-secret')", [orgId], /already has an owner-removal secret/);
    const { rows } = await client.query("select has_owner_removal_secret($1) as has", [orgId]);
    expect(rows[0].has).toBe(true);
  });

  it("refuses a writer suspending their own organization", async () => {
    const { orgId, accountant } = await org();
    await asUser(client, accountant);

    await refused("update organizations set status = 'suspended' where id = $1", [orgId], /Site Admin/);
  });

  it("refuses an owner backdating or clearing when their organization was suspended", async () => {
    const { orgId, accountant } = await org();
    await asUser(client, accountant);

    await refused("update organizations set suspended_at = '2020-01-01' where id = $1", [orgId], /Site Admin/);
  });

  it("still lets writers change ordinary settings", async () => {
    const { orgId, accountant } = await org();
    await asUser(client, accountant);

    const { rowCount } = await client.query("update organizations set inventory_enabled = true where id = $1", [orgId]);
    expect(rowCount).toBe(1);
  });
});
