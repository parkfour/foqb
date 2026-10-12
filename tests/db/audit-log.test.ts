import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { addMember, asUser, createAccount, createOrg, createUser } from "./helpers";

describe("audit log", () => {
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

  it("records an insert and an update on accounts, attributed to the acting user", async () => {
    const orgId = await createOrg(client);
    const owner = await createUser(client);
    await addMember(client, orgId, owner, "owner");

    await asUser(client, owner);
    const accountId = await createAccount(client, orgId, { name: "Original Name" });
    await client.query("update accounts set name = $1 where id = $2", ["Renamed", accountId]);

    await client.query("RESET ROLE");
    const { rows } = await client.query(
      "select action, changed_by, old_data, new_data from audit_log where table_name = 'accounts' and row_id = $1 order by changed_at",
      [accountId],
    );

    expect(rows).toHaveLength(2);
    expect(rows[0].action).toBe("insert");
    expect(rows[0].changed_by).toBe(owner);
    expect(rows[0].new_data.name).toBe("Original Name");
    expect(rows[1].action).toBe("update");
    expect(rows[1].old_data.name).toBe("Original Name");
    expect(rows[1].new_data.name).toBe("Renamed");
  });

  it("scopes audit log visibility to org members only", async () => {
    const orgId = await createOrg(client);
    const owner = await createUser(client);
    await addMember(client, orgId, owner, "owner");
    const outsider = await createUser(client);

    await asUser(client, owner);
    await createAccount(client, orgId);

    await client.query("RESET ROLE");
    await asUser(client, outsider);
    const { rows } = await client.query("select id from audit_log where organization_id = $1", [
      orgId,
    ]);
    expect(rows).toHaveLength(0);
  });

  it("rejects a direct insert into audit_log — only the trigger can write to it", async () => {
    const orgId = await createOrg(client);
    const owner = await createUser(client);
    await addMember(client, orgId, owner, "owner");

    await asUser(client, owner);
    await expect(
      client.query(
        "insert into audit_log (organization_id, table_name, row_id, action, changed_by) values ($1, 'accounts', gen_random_uuid(), 'insert', $2)",
        [orgId, owner],
      ),
    ).rejects.toThrow();
  });
});
