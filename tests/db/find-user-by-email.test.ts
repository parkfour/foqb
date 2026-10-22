import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { asUser, createUser } from "./helpers";

describe("find_user_id_by_email", () => {
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

  it("finds a login by email, whatever the case, for the server only", async () => {
    const id = await createUser(client, "lookup-me@example.com");

    await client.query("SET LOCAL ROLE service_role");
    const { rows } = await client.query("select find_user_id_by_email('Lookup-Me@Example.com') as id");
    expect(rows[0].id).toBe(id);
    const { rows: none } = await client.query("select find_user_id_by_email('nobody@example.com') as id");
    expect(none[0].id).toBeNull();
    await client.query("RESET ROLE");

    const someone = await createUser(client, "prober@example.com");
    await asUser(client, someone);
    await expect(client.query("select find_user_id_by_email('lookup-me@example.com')")).rejects.toThrow(
      /permission denied/,
    );
  });
});
