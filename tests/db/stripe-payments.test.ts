import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { addMember, asUser, createAccount, createOrg, createUser } from "./helpers";

describe("stripe payments (20260101000078)", () => {
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

  it("keeps the keys from every signed-in user, owners included", async () => {
    const org = await createOrg(client);
    const owner = await createUser(client, "stripe-owner@example.com");
    await addMember(client, org, owner, "owner");
    const stripeBalance = await createAccount(client, org, { name: "Stripe balance", type: "asset" });
    await client.query(
      "insert into organization_stripe_settings (organization_id, secret_key, deposit_account_id) values ($1, 'encrypted', $2)",
      [org, stripeBalance],
    );

    await asUser(client, owner);
    expect((await client.query("select * from organization_stripe_settings")).rows).toHaveLength(0);
    await client.query("SAVEPOINT s");
    await expect(
      client.query("update organization_stripe_settings set secret_key = 'mine' where organization_id = $1 returning 1", [org]),
    ).resolves.toMatchObject({ rowCount: 0 });
    await client.query("ROLLBACK TO SAVEPOINT s");
  });

  it("refuses another book's account for deposits", async () => {
    const org = await createOrg(client);
    const other = await createOrg(client, "Other");
    const theirs = await createAccount(client, other, { name: "Theirs", type: "asset" });
    await client.query("SAVEPOINT s");
    await expect(
      client.query(
        "insert into organization_stripe_settings (organization_id, secret_key, deposit_account_id) values ($1, 'x', $2)",
        [org, theirs],
      ),
    ).rejects.toThrow(/same organization/);
    await client.query("ROLLBACK TO SAVEPOINT s");
  });
});
