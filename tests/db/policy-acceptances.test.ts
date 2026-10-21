import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { asUser, createUser } from "./helpers";

describe("policy_acceptances", () => {
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

  async function rejected(sql: string, params: unknown[]): Promise<boolean> {
    await client.query("savepoint s");
    try {
      const result = await client.query(sql, params);
      await client.query("release savepoint s");
      return result.rowCount === 0;
    } catch {
      await client.query("rollback to savepoint s");
      return true;
    }
  }

  it("lets a user record and read only their own acceptance", async () => {
    const alice = await createUser(client, "alice@example.com");
    const bob = await createUser(client, "bob@example.com");
    await client.query("insert into policy_acceptances (user_id, version) values ($1, 'v1')", [bob]);

    await asUser(client, alice);
    await client.query("insert into policy_acceptances (user_id, version) values ($1, 'v1')", [alice]);
    const { rows } = await client.query("select user_id from policy_acceptances");
    expect(rows).toEqual([{ user_id: alice }]);

    expect(await rejected("insert into policy_acceptances (user_id, version) values ($1, 'v2')", [bob])).toBe(true);
  });

  it("doesn't let anyone rewrite or delete an acceptance record", async () => {
    const alice = await createUser(client, "alice@example.com");
    await client.query("insert into policy_acceptances (user_id, version) values ($1, 'v1')", [alice]);
    await asUser(client, alice);

    expect(await rejected("update policy_acceptances set version = 'v0' where user_id = $1", [alice])).toBe(true);
    expect(await rejected("delete from policy_acceptances where user_id = $1", [alice])).toBe(true);
    await client.query("RESET ROLE");

    const { rows } = await client.query("select version from policy_acceptances where user_id = $1", [alice]);
    expect(rows).toEqual([{ version: "v1" }]);
  });

  it("is removed along with the user's account", async () => {
    const alice = await createUser(client, "alice@example.com");
    await client.query("insert into policy_acceptances (user_id, version) values ($1, 'v1')", [alice]);

    await client.query("delete from auth.users where id = $1", [alice]);

    const { rows } = await client.query("select 1 from policy_acceptances where user_id = $1", [alice]);
    expect(rows).toHaveLength(0);
  });
});
