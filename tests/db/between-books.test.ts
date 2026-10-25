import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { addMember, asUser, createAccount, createOrg, createUser } from "./helpers";

describe("between your books (20260101000079)", () => {
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

  async function setup(householdRole: "owner" | "viewer" = "owner") {
    const household = await createOrg(client, "Household");
    const business = await createOrg(client, "Business");
    const user = await createUser(client, "both@example.com");
    await addMember(client, household, user, householdRole);
    await addMember(client, business, user, "owner");
    const card = await createAccount(client, household, { name: "Visa", type: "liability" });
    const owedByBusiness = await createAccount(client, household, { name: "Owed by the business", type: "asset" });
    const supplies = await createAccount(client, business, { name: "Supplies", type: "expense" });
    const owedToOwner = await createAccount(client, business, { name: "Owed to the owner", type: "liability" });
    return { household, business, user, card, owedByBusiness, supplies, owedToOwner };
  }

  const post = (s: Awaited<ReturnType<typeof setup>>, amount = 42.5) =>
    client.query("select post_between_books('paid_for', '2026-10-20', 'Printer ink', $1, $2) as id", [
      JSON.stringify({ org_id: s.household, lines: [
        { account_id: s.owedByBusiness, debit: amount, credit: 0 },
        { account_id: s.card, debit: 0, credit: amount },
      ] }),
      JSON.stringify({ org_id: s.business, lines: [
        { account_id: s.supplies, debit: amount, credit: 0 },
        { account_id: s.owedToOwner, debit: 0, credit: amount },
      ] }),
    ]);

  it("posts both books' entries and links them", async () => {
    const s = await setup();
    await asUser(client, s.user);
    const { rows } = await post(s);
    const link = (await client.query("select * from inter_book_links where id = $1", [rows[0].id])).rows[0];
    const entries = await client.query(
      "select organization_id, status, memo from journal_entries where id in ($1, $2) order by organization_id = $3",
      [link.entry_a, link.entry_b, s.household],
    );
    expect(entries.rows).toEqual([
      { organization_id: s.business, status: "posted", memo: "Printer ink" },
      { organization_id: s.household, status: "posted", memo: "Printer ink" },
    ]);
  });

  it("posts neither when the person can't post in one of the books", async () => {
    const s = await setup("viewer");
    await asUser(client, s.user);
    await client.query("SAVEPOINT s");
    await expect(post(s)).rejects.toThrow(/row-level security/);
    await client.query("ROLLBACK TO SAVEPOINT s");
    await client.query("RESET ROLE");
    expect((await client.query("select count(*)::int as n from journal_entries where organization_id in ($1, $2)", [s.household, s.business])).rows[0]).toEqual({ n: 0 });
  });

  it("refuses an account from the wrong book", async () => {
    const s = await setup();
    await asUser(client, s.user);
    await client.query("SAVEPOINT s");
    await expect(
      client.query("select post_between_books('paid_for', '2026-10-20', null, $1, $2)", [
        JSON.stringify({ org_id: s.household, lines: [
          { account_id: s.supplies, debit: 5, credit: 0 },
          { account_id: s.card, debit: 0, credit: 5 },
        ] }),
        JSON.stringify({ org_id: s.business, lines: [
          { account_id: s.supplies, debit: 5, credit: 0 },
          { account_id: s.owedToOwner, debit: 0, credit: 5 },
        ] }),
      ]),
    ).rejects.toThrow(/same organization/);
    await client.query("ROLLBACK TO SAVEPOINT s");
  });
});
