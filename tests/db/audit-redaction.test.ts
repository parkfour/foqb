import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { addMember, asUser, createOrg, createUser } from "./helpers";

describe("audit log redacts organization secrets", () => {
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

  it("logs that the owner-removal secret and logo changed, but not their values", async () => {
    const orgId = await createOrg(client, "Audit Org");
    const owner = await createUser(client, "audit-owner@example.com");
    const viewer = await createUser(client, "audit-viewer@example.com");
    await addMember(client, orgId, owner, "owner");
    await addMember(client, orgId, viewer, "viewer");

    await asUser(client, owner);
    await client.query("select set_owner_removal_secret($1, 'correct-horse')", [orgId]);
    await client.query("update organizations set logo_data_url = 'data:image/png;base64,AAAA' where id = $1", [orgId]);
    await client.query("RESET ROLE");

    await asUser(client, viewer);
    const { rows } = await client.query(
      "select old_data, new_data from get_audit_log($1) where table_name = 'organizations' order by changed_at",
      [orgId],
    );
    const logged = JSON.stringify(rows);
    expect(logged).not.toMatch(/\$2[aby]\$/); // no bcrypt hash
    expect(logged).not.toContain("base64,AAAA"); // no logo image
    expect(rows.some((r) => r.old_data.owner_removal_secret_hash === false && r.new_data.owner_removal_secret_hash === true)).toBe(true);
    expect(rows.some((r) => r.new_data.logo_data_url && r.new_data.logo_data_url !== r.old_data.logo_data_url)).toBe(true);
  });
});
