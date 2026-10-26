import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { addMember, asUser, createOrg, createUser } from "./helpers";

describe("plugin acknowledgements (20260101000095)", () => {
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

  const acknowledge = "select acknowledge_plugin('payroll', '2026-10', $1)";

  it("lets only a Site Admin acknowledge for the instance and only an owner for a book, recording who", async () => {
    const org = await createOrg(client);
    const owner = await createUser(client, "ack-owner@example.com");
    const accountant = await createUser(client, "ack-accountant@example.com");
    const admin = await createUser(client, "ack-admin@example.com");
    await addMember(client, org, owner, "owner");
    await addMember(client, org, accountant, "accountant");
    await client.query("insert into site_admins (user_id) values ($1)", [admin]);

    await asUser(client, owner);
    expect(await fails(acknowledge, [null])).toMatch(/Only a Site Admin/);
    await client.query(acknowledge, [org]);
    await client.query(acknowledge, [org]); // twice is fine

    await client.query("RESET ROLE");
    await asUser(client, accountant);
    expect(await fails(acknowledge, [org])).toMatch(/Only an owner/);
    expect(await fails("insert into plugin_acknowledgements (organization_id, plugin_id, version) values ($1, 'payroll', '2026-10')", [org])).toMatch(
      /row-level security/,
    );

    await client.query("RESET ROLE");
    await asUser(client, admin);
    await client.query(acknowledge, [null]);

    await client.query("RESET ROLE");
    const { rows } = await client.query(
      "select organization_id, acknowledged_by from plugin_acknowledgements where plugin_id = 'payroll' order by organization_id nulls first",
    );
    expect(rows).toEqual([
      { organization_id: null, acknowledged_by: admin },
      { organization_id: org, acknowledged_by: owner },
    ]);
  });
});
