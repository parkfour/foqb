import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { createAccount, createOrg } from "./helpers";

describe("get_net_worth_series", () => {
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

  async function entry(orgId: string, date: string, status: string, lines: [string, number, number][]) {
    const { rows } = await client.query(
      "insert into journal_entries (organization_id, entry_date, memo, status) values ($1, $2, 'x', 'draft') returning id",
      [orgId, date],
    );
    for (const [account, debit, credit] of lines) {
      await client.query("insert into journal_lines (journal_entry_id, account_id, debit, credit) values ($1, $2, $3, $4)", [
        rows[0].id,
        account,
        debit,
        credit,
      ]);
    }
    if (status !== "draft") await client.query("update journal_entries set status = $2 where id = $1", [rows[0].id, status]);
  }

  it("gives what the asset and liability accounts held at the end of each date, from posted entries", async () => {
    const orgId = await createOrg(client);
    const otherOrg = await createOrg(client);
    const checking = await createAccount(client, orgId, { type: "asset" });
    const card = await createAccount(client, orgId, { type: "liability" });
    const equity = await createAccount(client, orgId, { type: "equity" });
    const groceries = await createAccount(client, orgId, { type: "expense" });
    const theirs = await createAccount(client, otherOrg, { type: "asset" });
    const theirEquity = await createAccount(client, otherOrg, { type: "equity" });

    await entry(orgId, "2026-01-01", "posted", [[checking, 1000, 0], [equity, 0, 1000]]);
    await entry(orgId, "2026-01-15", "posted", [[groceries, 50, 0], [card, 0, 50]]);
    await entry(orgId, "2026-01-20", "draft", [[groceries, 999, 0], [checking, 0, 999]]);
    await entry(orgId, "2026-01-25", "void", [[groceries, 999, 0], [checking, 0, 999]]);
    await entry(otherOrg, "2026-01-01", "posted", [[theirs, 777, 0], [theirEquity, 0, 777]]);

    const { rows } = await client.query(
      "select as_of::text, total_assets::float as a, total_liabilities::float as l from get_net_worth_series($1, $2::date[])",
      [orgId, ["2025-12-31", "2026-01-01", "2026-01-31"]],
    );

    expect(rows).toEqual([
      { as_of: "2025-12-31", a: 0, l: 0 },
      { as_of: "2026-01-01", a: 1000, l: 0 },
      { as_of: "2026-01-31", a: 1000, l: 50 },
    ]);
  });
});
