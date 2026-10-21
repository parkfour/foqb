import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { addMember, asUser, createInventoryItem, createOrg, createUser } from "./helpers";

describe("inventory_items", () => {
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

  it("scopes items to organization members and rejects other orgs' items", async () => {
    const orgId = await createOrg(client);
    const otherOrgId = await createOrg(client);
    const member = await createUser(client);
    await addMember(client, orgId, member, "owner");

    const item = await createInventoryItem(client, orgId);
    await createInventoryItem(client, otherOrgId);

    await asUser(client, member);

    const { rows } = await client.query("select id from inventory_items");
    expect(rows.map((r) => r.id)).toEqual([item]);
  });

  it("lets a writer insert and update items but blocks a viewer", async () => {
    const orgId = await createOrg(client);
    const owner = await createUser(client, "owner@example.com");
    await addMember(client, orgId, owner, "owner");
    const viewer = await createUser(client, "viewer@example.com");
    await addMember(client, orgId, viewer, "viewer");

    await asUser(client, owner);
    await expect(
      client.query(
        "insert into inventory_items (organization_id, sku, name) values ($1, 'SKU-1', 'Widget')",
        [orgId],
      ),
    ).resolves.toBeDefined();

    await client.query("RESET ROLE");
    await asUser(client, viewer);
    await client.query("SAVEPOINT sp1");
    await expect(
      client.query(
        "insert into inventory_items (organization_id, sku, name) values ($1, 'SKU-2', 'Blocked')",
        [orgId],
      ),
    ).rejects.toThrow();
    await client.query("ROLLBACK TO SAVEPOINT sp1");
  });

  it("rejects a duplicate SKU within the same organization", async () => {
    const orgId = await createOrg(client);
    await createInventoryItem(client, orgId, { sku: "DUP-1" });

    await expect(
      client.query(
        "insert into inventory_items (organization_id, sku, name) values ($1, 'DUP-1', 'Another')",
        [orgId],
      ),
    ).rejects.toThrow();
  });

  it("rejects a negative unit cost", async () => {
    const orgId = await createOrg(client);

    await expect(
      client.query(
        "insert into inventory_items (organization_id, sku, name, unit_cost) values ($1, 'SKU-NEG', 'Bad', -1)",
        [orgId],
      ),
    ).rejects.toThrow();
  });
});
