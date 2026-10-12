import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { newId } from "./helpers";

async function hit(client: Client, key: string, limit: number, windowSeconds = 900): Promise<boolean> {
  const { rows } = await client.query("select check_rate_limit($1, $2, $3) as allowed", [
    key,
    limit,
    windowSeconds,
  ]);
  return rows[0].allowed as boolean;
}

describe("check_rate_limit", () => {
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

  it("allows requests up to the limit, then denies", async () => {
    const key = newId();

    expect(await hit(client, key, 3)).toBe(true);
    expect(await hit(client, key, 3)).toBe(true);
    expect(await hit(client, key, 3)).toBe(true);
    expect(await hit(client, key, 3)).toBe(false);
    expect(await hit(client, key, 3)).toBe(false);
  });

  it("tracks separate keys independently", async () => {
    const keyA = newId();
    const keyB = newId();

    expect(await hit(client, keyA, 1)).toBe(true);
    expect(await hit(client, keyA, 1)).toBe(false);
    // keyB has its own budget, unaffected by keyA being exhausted.
    expect(await hit(client, keyB, 1)).toBe(true);
  });

  it("a limit of 0 denies immediately", async () => {
    const key = newId();
    expect(await hit(client, key, 0)).toBe(false);
  });
});

describe("internal RPC privileges", () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: inject("databaseUrl") });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  it.each([
    ["anon", "check_rate_limit(text, int, int)"],
    ["authenticated", "check_rate_limit(text, int, int)"],
    ["anon", "claim_cron_run(text, int)"],
    ["authenticated", "claim_cron_run(text, int)"],
  ])("%s cannot execute %s", async (role, fn) => {
    const { rows } = await client.query("select has_function_privilege($1, $2, 'execute') as allowed", [
      role,
      fn,
    ]);
    expect(rows[0].allowed).toBe(false);
  });

  it("service_role can still execute both", async () => {
    const { rows } = await client.query(
      `select has_function_privilege('service_role', 'check_rate_limit(text, int, int)', 'execute')
          and has_function_privilege('service_role', 'claim_cron_run(text, int)', 'execute') as allowed`,
    );
    expect(rows[0].allowed).toBe(true);
  });
});
