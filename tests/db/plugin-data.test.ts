import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { addMember, asUser, createOrg, createUser } from "./helpers";

describe("plugin data (20260101000060)", () => {
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

  async function setup() {
    const orgId = await createOrg(client);
    const owner = await createUser(client, "owner@example.com");
    const viewer = await createUser(client, "viewer@example.com");
    const outsider = await createUser(client, "outsider@example.com");
    await addMember(client, orgId, owner, "owner");
    await addMember(client, orgId, viewer, "viewer");
    await createOrg(client, "Other");
    return { orgId, owner, viewer, outsider };
  }

  async function as(userId: string) {
    await client.query("RESET ROLE");
    await asUser(client, userId);
  }

  async function fails(sql: string, params: unknown[]): Promise<string> {
    await client.query("SAVEPOINT attempt");
    try {
      await client.query(sql, params);
      return "";
    } catch (err) {
      return (err as Error).message;
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT attempt");
    }
  }

  const insert = "insert into plugin_data (organization_id, plugin_id, key, value) values ($1, $2, $3, $4)";

  it("lets writers keep values that members can read and others can't see", async () => {
    const s = await setup();
    await as(s.owner);
    await client.query(insert, [s.orgId, "tax-forms", "2025/w2", JSON.stringify({ wages: 1000 })]);

    await as(s.viewer);
    const seen = await client.query("select value from plugin_data where plugin_id = 'tax-forms'");
    expect(seen.rows).toEqual([{ value: { wages: 1000 } }]);
    expect(await fails(insert, [s.orgId, "tax-forms", "2025/other", "{}"])).toMatch(/row-level security/);
    const changed = await client.query("update plugin_data set value = '{}' returning id");
    expect(changed.rowCount).toBe(0);

    await as(s.outsider);
    expect((await client.query("select * from plugin_data")).rowCount).toBe(0);
    expect(await fails(insert, [s.orgId, "tax-forms", "2025/x", "{}"])).toMatch(/row-level security/);
  });

  it("keeps one value per key, with its book and plugin fixed", async () => {
    const s = await setup();
    await as(s.owner);
    await client.query(insert, [s.orgId, "tax-forms", "k", "1"]);
    expect(await fails(insert, [s.orgId, "tax-forms", "k", "2"])).toMatch(/duplicate key/);
    expect(await fails("update plugin_data set plugin_id = 'other' where key = 'k'", [])).toMatch(/stays with its book and plugin/);
    expect(await fails(insert, [s.orgId, "Not Valid", "k", "1"])).toMatch(/check constraint/);
  });
});
