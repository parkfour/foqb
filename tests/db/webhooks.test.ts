import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { addMember, asUser, createOrg, createUser } from "./helpers";

describe("webhooks", () => {
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

  async function refused(sql: string, params: unknown[], pattern: RegExp) {
    await client.query("SAVEPOINT s");
    await expect(client.query(sql, params)).rejects.toThrow(pattern);
    await client.query("ROLLBACK TO SAVEPOINT s");
  }

  async function setup() {
    const orgId = await createOrg(client, "Hook Org");
    const owner = await createUser(client, "hook-owner@example.com");
    const accountant = await createUser(client, "hook-accountant@example.com");
    await addMember(client, orgId, owner, "owner");
    await addMember(client, orgId, accountant, "accountant");
    return { orgId, owner, accountant };
  }

  const insertWebhook =
    "insert into organization_webhooks (organization_id, url, events, secret_encrypted) values ($1, $2, $3, 'encrypted') returning id";

  it("lets an owner add a webhook, but no signed-in user read its secret", async () => {
    const { orgId, owner } = await setup();
    await asUser(client, owner);
    await client.query(insertWebhook, [orgId, "https://hooks.example.com/x", ["invoice:created"]]);
    await refused("select secret_encrypted from organization_webhooks", [], /permission denied/);
    const { rows } = await client.query("select url, events from organization_webhooks");
    expect(rows).toEqual([{ url: "https://hooks.example.com/x", events: ["invoice:created"] }]);
  });

  it("keeps webhooks and their deliveries away from non-owners", async () => {
    const { orgId, accountant } = await setup();
    const { rows } = await client.query(insertWebhook, [orgId, "https://hooks.example.com/x", ["bill:created"]]);
    await client.query(
      "insert into webhook_deliveries (organization_id, webhook_id, event, payload) values ($1, $2, 'bill:created', '{}')",
      [orgId, rows[0].id],
    );

    await asUser(client, accountant);
    await refused(insertWebhook, [orgId, "https://hooks.example.com/y", ["bill:created"]], /row-level security/);
    expect((await client.query("select id from organization_webhooks")).rows).toEqual([]);
    expect((await client.query("select id from webhook_deliveries")).rows).toEqual([]);
  });

  it("lets only the server write deliveries", async () => {
    const { orgId, owner } = await setup();
    await asUser(client, owner);
    const { rows } = await client.query(insertWebhook, [orgId, "https://hooks.example.com/x", ["bill:created"]]);
    await refused(
      "insert into webhook_deliveries (organization_id, webhook_id, event, payload) values ($1, $2, 'bill:created', '{}')",
      [orgId, rows[0].id],
      /row-level security/,
    );
  });

  it("refuses plain http and events that don't exist", async () => {
    const { orgId, owner } = await setup();
    await asUser(client, owner);
    await refused(insertWebhook, [orgId, "http://hooks.example.com/x", ["bill:created"]], /check constraint/);
    await refused(insertWebhook, [orgId, "https://hooks.example.com/x", ["journal:posted"]], /check constraint/);
    await refused(insertWebhook, [orgId, "https://hooks.example.com/x", []], /check constraint/);
  });
});
