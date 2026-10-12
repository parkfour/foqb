import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { addMember, asUser, createAccount, createOrg, createUser } from "./helpers";

describe("fixed assets", () => {
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

  it("lets a writer create a fixed asset, blocks a viewer", async () => {
    const orgId = await createOrg(client);
    const owner = await createUser(client);
    await addMember(client, orgId, owner, "owner");
    const viewer = await createUser(client);
    await addMember(client, orgId, viewer, "viewer");
    const assetAccount = await createAccount(client, orgId, { type: "asset" });
    const accumDeprAccount = await createAccount(client, orgId, { type: "asset" });
    const expenseAccount = await createAccount(client, orgId, { type: "expense" });

    await asUser(client, owner);
    await expect(
      client.query(
        `insert into fixed_assets
          (organization_id, name, asset_account_id, accumulated_depreciation_account_id,
           depreciation_expense_account_id, purchase_date, cost, salvage_value,
           useful_life_months, next_depreciation_date)
         values ($1, 'Laptop', $2, $3, $4, '2026-01-01', 3000, 0, 36, '2026-01-01')`,
        [orgId, assetAccount, accumDeprAccount, expenseAccount],
      ),
    ).resolves.toBeDefined();

    await client.query("RESET ROLE");
    await asUser(client, viewer);
    const { rows } = await client.query("select id from fixed_assets where organization_id = $1", [
      orgId,
    ]);
    expect(rows).toHaveLength(1);

    await expect(
      client.query(
        `insert into fixed_assets
          (organization_id, name, asset_account_id, accumulated_depreciation_account_id,
           depreciation_expense_account_id, purchase_date, cost, salvage_value,
           useful_life_months, next_depreciation_date)
         values ($1, 'Blocked', $2, $3, $4, '2026-01-01', 1000, 0, 12, '2026-01-01')`,
        [orgId, assetAccount, accumDeprAccount, expenseAccount],
      ),
    ).rejects.toThrow();
  });

  it("rejects a salvage value that is not less than cost", async () => {
    const orgId = await createOrg(client);
    const owner = await createUser(client);
    await addMember(client, orgId, owner, "owner");
    const assetAccount = await createAccount(client, orgId, { type: "asset" });
    const accumDeprAccount = await createAccount(client, orgId, { type: "asset" });
    const expenseAccount = await createAccount(client, orgId, { type: "expense" });

    await asUser(client, owner);
    await expect(
      client.query(
        `insert into fixed_assets
          (organization_id, name, asset_account_id, accumulated_depreciation_account_id,
           depreciation_expense_account_id, purchase_date, cost, salvage_value,
           useful_life_months, next_depreciation_date)
         values ($1, 'Bad Asset', $2, $3, $4, '2026-01-01', 1000, 1000, 12, '2026-01-01')`,
        [orgId, assetAccount, accumDeprAccount, expenseAccount],
      ),
    ).rejects.toThrow();
  });
});
