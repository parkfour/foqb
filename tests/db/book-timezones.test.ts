import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { addMember, asUser, createOrg, createUser, newId } from "./helpers";

describe("book timezones", () => {
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

  async function orgWithOwnerAndAccountant() {
    const orgId = await createOrg(client, "Clock Org");
    const owner = await createUser(client, "clock-owner@example.com");
    const accountant = await createUser(client, "clock-accountant@example.com");
    await addMember(client, orgId, owner, "owner");
    await addMember(client, orgId, accountant, "accountant");
    return { orgId, owner, accountant };
  }

  const setTimezone = "select set_organization_timezone($1, $2, 'America/Chicago')";

  it("lets an owner change it and logs the days the switch spans", async () => {
    const { orgId, owner } = await orgWithOwnerAndAccountant();
    await asUser(client, owner);
    await client.query(setTimezone, [orgId, "Europe/Berlin"]);
    await client.query("RESET ROLE");

    const { rows: org } = await client.query("select timezone from organizations where id = $1", [orgId]);
    expect(org[0].timezone).toBe("Europe/Berlin");

    // From the instance default (Chicago), today's date in each zone.
    const { rows: expected } = await client.query(
      "select least(c, b)::text as first, greatest(c, b)::text as last from (select (now() at time zone 'America/Chicago')::date c, (now() at time zone 'Europe/Berlin')::date b) d",
    );
    const { rows: changes } = await client.query(
      "select old_timezone, new_timezone, first_affected::text as first, last_affected::text as last from organization_timezone_changes where organization_id = $1",
      [orgId],
    );
    expect(changes).toEqual([
      { old_timezone: "America/Chicago", new_timezone: "Europe/Berlin", first: expected[0].first, last: expected[0].last },
    ]);
  });

  it("refuses non-owners, direct updates and unknown timezones", async () => {
    const { orgId, owner, accountant } = await orgWithOwnerAndAccountant();

    await asUser(client, accountant);
    await refused(setTimezone, [orgId, "Europe/Berlin"], /only an owner/i);
    await client.query("RESET ROLE");

    await asUser(client, owner);
    await refused("update organizations set timezone = 'Europe/Berlin' where id = $1", [orgId], /only be changed from Settings/);
    await refused(setTimezone, [orgId, "Mars/Olympus"], /unknown timezone/i);
    await client.query("RESET ROLE");

    await refused("update organizations set timezone = 'Mars/Olympus' where id = $1", [orgId], /unknown timezone/i);
  });

  it("logs nothing when the effective timezone doesn't change", async () => {
    const { orgId, owner } = await orgWithOwnerAndAccountant();
    await asUser(client, owner);
    await client.query(setTimezone, [orgId, "America/Chicago"]);
    await client.query("RESET ROLE");

    const { rows } = await client.query("select count(*)::int as n from organization_timezone_changes where organization_id = $1", [orgId]);
    expect(rows[0].n).toBe(0);
  });

  it("restores a book's timezone and its change history", async () => {
    const orgId = newId();
    const snapshot = {
      organization: { id: orgId, name: "Clock Restore", timezone: "Europe/Berlin" },
      timezone_changes: [
        { id: newId(), changed_at: "2026-10-18T01:30:00Z", old_timezone: "America/Chicago", new_timezone: "Europe/Berlin",
          first_affected: "2026-10-17", last_affected: "2026-10-18" },
      ],
      accounts: [], journal_entries: [], customers: [], vendors: [], invoices: [], bills: [], invoice_payments: [],
      bill_payments: [], items: [], inventory_items: [], fixed_assets: [], recurring_invoices: [], recurring_bills: [],
      bank_transactions: [], bank_reconciliations: [], categorization_rules: [],
    };

    const user = await createUser(client, "clock-restorer@example.com");
    await asUser(client, user);
    await client.query("select restore_organization($1)", [JSON.stringify(snapshot)]);
    await client.query("RESET ROLE");

    const { rows: org } = await client.query("select timezone from organizations where id = $1", [orgId]);
    expect(org[0].timezone).toBe("Europe/Berlin");
    const { rows: changes } = await client.query(
      "select first_affected::text as first, last_affected::text as last from organization_timezone_changes where organization_id = $1",
      [orgId],
    );
    expect(changes).toEqual([{ first: "2026-10-17", last: "2026-10-18" }]);
  });
});
