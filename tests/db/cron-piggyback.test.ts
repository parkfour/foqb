import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";

async function claim(client: Client, jobName: string, minIntervalSeconds: number): Promise<boolean> {
  const { rows } = await client.query("select claim_cron_run($1, $2) as claimed", [
    jobName,
    minIntervalSeconds,
  ]);
  return rows[0].claimed as boolean;
}

describe("claim_cron_run", () => {
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

  it("claims on the first call for a never-run job", async () => {
    expect(await claim(client, "job-a", 3600)).toBe(true);
  });

  it("does not claim again before the interval has elapsed", async () => {
    expect(await claim(client, "job-b", 3600)).toBe(true);
    expect(await claim(client, "job-b", 3600)).toBe(false);
  });

  it("claims again once the interval has elapsed", async () => {
    expect(await claim(client, "job-c", 3600)).toBe(true);
    // Backdate the recorded run so the interval has clearly passed —
    // faster and more deterministic than actually waiting an hour.
    await client.query(
      "update cron_runs set last_run_at = now() - interval '2 hours' where job_name = $1",
      ["job-c"],
    );
    expect(await claim(client, "job-c", 3600)).toBe(true);
  });

  it("tracks separate jobs independently", async () => {
    expect(await claim(client, "job-d", 3600)).toBe(true);
    expect(await claim(client, "job-d", 3600)).toBe(false);
    // job-e has never run, so it's claimable regardless of job-d's state.
    expect(await claim(client, "job-e", 3600)).toBe(true);
  });
});
