import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { asUser, createUser } from "./helpers";

describe("site settings: sign-ups", () => {
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

  async function setSignups(enabled: boolean) {
    await client.query("update site_settings set signups_enabled = $1", [enabled]);
  }

  it("lets anyone (even signed out) read the settings", async () => {
    await client.query("SET LOCAL ROLE anon");
    const { rows } = await client.query("select signups_enabled from site_settings");
    expect(rows).toEqual([{ signups_enabled: true }]);
  });

  it("refuses a new auth user while sign-ups are off", async () => {
    await setSignups(false);
    await expect(createUser(client, "stranger@example.com")).rejects.toThrow(/Sign-ups are disabled/);
  });

  it("allows a new auth user the server exempted, once", async () => {
    await setSignups(false);
    await client.query("insert into signup_exemptions (email) values ('invited@example.com')");

    await createUser(client, "Invited@example.com");

    const { rows } = await client.query("select 1 from signup_exemptions");
    expect(rows).toHaveLength(0);
  });

  it("ignores an exemption older than 10 minutes", async () => {
    await setSignups(false);
    await client.query(
      "insert into signup_exemptions (email, created_at) values ('late@example.com', now() - interval '11 minutes')",
    );

    await expect(createUser(client, "late@example.com")).rejects.toThrow(/Sign-ups are disabled/);
  });

  it("only lets a site admin change the settings, and logs the change", async () => {
    const admin = await createUser(client, "settings-admin@example.com");
    await client.query("insert into site_admins (user_id) values ($1) on conflict do nothing", [admin]);
    const user = await createUser(client, "settings-user@example.com");

    await client.query("SAVEPOINT s");
    await asUser(client, user);
    const denied = await client.query("update site_settings set signups_enabled = false");
    expect(denied.rowCount).toBe(0);
    await client.query("ROLLBACK TO SAVEPOINT s");

    await asUser(client, admin);
    const allowed = await client.query("update site_settings set signups_enabled = false");
    expect(allowed.rowCount).toBe(1);
    await client.query("RESET ROLE");

    const { rows } = await client.query(
      "select action from site_admin_actions where site_admin_id = $1",
      [admin],
    );
    expect(rows).toEqual([{ action: "signups_off" }]);
  });

  it("keeps exemptions out of reach of signed-in users", async () => {
    const user = await createUser(client, "sneaky@example.com");
    await asUser(client, user);
    await expect(
      client.query("insert into signup_exemptions (email) values ('me@example.com')"),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("site settings: plugin modes", () => {
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

  it("takes off, choose or on per plugin, and nothing else", async () => {
    await client.query(`update site_settings set plugin_modes = '{"webhooks": "off", "receipt-ocr": "on"}'`);
    await client.query("SAVEPOINT s");
    await expect(client.query(`update site_settings set plugin_modes = '{"webhooks": "maybe"}'`)).rejects.toThrow(/check/);
    await client.query("ROLLBACK TO SAVEPOINT s");
    await expect(client.query(`update site_settings set plugin_modes = '["webhooks"]'`)).rejects.toThrow(/check/);
  });

  it("logs a site admin's change", async () => {
    const admin = await createUser(client, "plugins-admin@example.com");
    await client.query("insert into site_admins (user_id) values ($1) on conflict do nothing", [admin]);
    await asUser(client, admin);
    await client.query(`update site_settings set plugin_modes = '{"webhooks": "off"}'`);
    await client.query("RESET ROLE");

    const { rows } = await client.query("select action from site_admin_actions where site_admin_id = $1", [admin]);
    expect(rows).toEqual([{ action: "plugins_changed" }]);
  });
});
