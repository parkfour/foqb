import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { addMember, asUser, createAccount, createOrg, createUser, newId } from "./helpers";

describe("household workspace & RLS boundaries", () => {
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

  async function createHouseholdOrg(client: Client, name = "Household"): Promise<string> {
    const id = newId();
    await client.query(
      "insert into organizations (id, name, workspace_type) values ($1, $2, 'household')",
      [id, name],
    );
    return id;
  }

  describe("workspace_type constraint", () => {
    it("defaults to 'business'", async () => {
      const orgId = await createOrg(client, "Default Org");
      const { rows } = await client.query("select workspace_type from organizations where id = $1", [
        orgId,
      ]);
      expect(rows[0]?.workspace_type).toBe("business");
    });

    it("allows 'household' workspace_type", async () => {
      const orgId = await createHouseholdOrg(client, "My Household");
      const { rows } = await client.query("select workspace_type from organizations where id = $1", [
        orgId,
      ]);
      expect(rows[0]?.workspace_type).toBe("household");
    });

    it("rejects invalid workspace_type values", async () => {
      const id = newId();
      await expect(
        client.query(
          "insert into organizations (id, name, workspace_type) values ($1, 'Invalid Org', 'enterprise')",
          [id],
        ),
      ).rejects.toThrow();
    });
  });

  describe("cross-persona RLS isolation", () => {
    it("ensures household members cannot see business organizations or accounts", async () => {
      const businessOrg = await createOrg(client, "Acme Corp");
      const householdOrg = await createHouseholdOrg(client, "Smith Household");

      const householdUser = await createUser(client, "family@example.com");
      await addMember(client, householdOrg, householdUser, "owner");

      const bizAccount = await createAccount(client, businessOrg, { name: "Business Checking" });
      const homeAccount = await createAccount(client, householdOrg, { name: "Household Checking" });

      await asUser(client, householdUser);
      const homeVisibleOrgs = await client.query("select id, workspace_type from organizations");
      expect(homeVisibleOrgs.rows.map((r) => r.id)).toEqual([householdOrg]);
      expect(homeVisibleOrgs.rows[0].workspace_type).toBe("household");

      const homeVisibleAccounts = await client.query("select id from accounts");
      expect(homeVisibleAccounts.rows.map((r) => r.id)).toEqual([homeAccount]);
      expect(homeVisibleAccounts.rows.map((r) => r.id)).not.toContain(bizAccount);
    });

    it("ensures business members cannot see household organizations or accounts", async () => {
      const businessOrg = await createOrg(client, "Acme Corp");
      const householdOrg = await createHouseholdOrg(client, "Smith Household");

      const businessUser = await createUser(client, "biz@example.com");
      await addMember(client, businessOrg, businessUser, "owner");

      const bizAccount = await createAccount(client, businessOrg, { name: "Business Checking" });
      const homeAccount = await createAccount(client, householdOrg, { name: "Household Checking" });

      await asUser(client, businessUser);
      const bizVisibleOrgs = await client.query("select id, workspace_type from organizations");
      expect(bizVisibleOrgs.rows.map((r) => r.id)).toEqual([businessOrg]);
      expect(bizVisibleOrgs.rows[0].workspace_type).toBe("business");

      const bizVisibleAccounts = await client.query("select id from accounts");
      expect(bizVisibleAccounts.rows.map((r) => r.id)).toEqual([bizAccount]);
      expect(bizVisibleAccounts.rows.map((r) => r.id)).not.toContain(homeAccount);
    });

    it("prevents household members from inserting data into a business organization", async () => {
      const businessOrg = await createOrg(client, "Acme Corp");
      const householdOrg = await createHouseholdOrg(client, "Smith Household");

      const householdUser = await createUser(client, "family2@example.com");
      await addMember(client, householdOrg, householdUser, "owner");

      await asUser(client, householdUser);
      await expect(
        client.query(
          "insert into accounts (organization_id, account_number, name, type) values ($1, '9001', 'Illegal', 'asset')",
          [businessOrg],
        ),
      ).rejects.toThrow();
    });

    it("prevents business members from inserting data into a household organization", async () => {
      const businessOrg = await createOrg(client, "Acme Corp");
      const householdOrg = await createHouseholdOrg(client, "Smith Household");

      const businessUser = await createUser(client, "biz2@example.com");
      await addMember(client, businessOrg, businessUser, "owner");

      await asUser(client, businessUser);
      await expect(
        client.query(
          "insert into accounts (organization_id, account_number, name, type) values ($1, '9002', 'Illegal', 'asset')",
          [householdOrg],
        ),
      ).rejects.toThrow();
    });
  });

  describe("properties RLS", () => {
    it("allows household members to read properties in their organization", async () => {
      const householdOrg = await createHouseholdOrg(client, "Smith Household");
      const householdUser = await createUser(client, "home_prop@example.com");
      await addMember(client, householdOrg, householdUser, "owner");

      const propId = newId();
      await client.query(
        "insert into properties (id, organization_id, name, address_street, purchase_price, estimated_value) values ($1, $2, 'Main House', '123 Main St', 500000, 650000)",
        [propId, householdOrg],
      );

      await asUser(client, householdUser);
      const homeProps = await client.query("select id, name from properties");
      expect(homeProps.rows.map((r) => r.id)).toEqual([propId]);
    });

    it("prevents business members from viewing or inserting properties in household organizations", async () => {
      const householdOrg = await createHouseholdOrg(client, "Smith Household");
      const businessOrg = await createOrg(client, "Acme Corp");

      const businessUser = await createUser(client, "biz_prop@example.com");
      await addMember(client, businessOrg, businessUser, "owner");

      await client.query(
        "insert into properties (id, organization_id, name) values ($1, $2, 'Household Villa')",
        [newId(), householdOrg],
      );

      await asUser(client, businessUser);
      const bizProps = await client.query("select id from properties");
      expect(bizProps.rows).toHaveLength(0);

      await expect(
        client.query(
          "insert into properties (id, organization_id, name) values ($1, $2, 'Unauthorized House')",
          [newId(), householdOrg],
        ),
      ).rejects.toThrow();
    });

  });

  describe("net_worth_snapshots RLS", () => {
    it("allows household members to read net worth snapshots in their organization", async () => {
      const householdOrg = await createHouseholdOrg(client, "Smith Household");
      const householdUser = await createUser(client, "home_snap@example.com");
      await addMember(client, householdOrg, householdUser, "owner");

      const snapId = newId();
      await client.query(
        `insert into net_worth_snapshots (id, organization_id, date, total_assets, total_liabilities, net_worth, breakdown)
         values ($1, $2, '2026-03-01', 1000000, 200000, 800000, '{"cash": 100000}'::jsonb)`,
        [snapId, householdOrg],
      );

      await asUser(client, householdUser);
      const homeSnaps = await client.query("select id, net_worth from net_worth_snapshots");
      expect(homeSnaps.rows.map((r) => r.id)).toEqual([snapId]);
    });

    it("prevents business members from viewing or inserting net worth snapshots in household organizations", async () => {
      const householdOrg = await createHouseholdOrg(client, "Smith Household");
      const businessOrg = await createOrg(client, "Acme Corp");

      const businessUser = await createUser(client, "biz_snap@example.com");
      await addMember(client, businessOrg, businessUser, "owner");

      await client.query(
        `insert into net_worth_snapshots (id, organization_id, date, total_assets, total_liabilities, net_worth, breakdown)
         values ($1, $2, '2026-03-01', 1000000, 200000, 800000, '{"cash": 100000}'::jsonb)`,
        [newId(), householdOrg],
      );

      await asUser(client, businessUser);
      const bizSnaps = await client.query("select id from net_worth_snapshots");
      expect(bizSnaps.rows).toHaveLength(0);

      await expect(
        client.query(
          `insert into net_worth_snapshots (organization_id, date, total_assets, total_liabilities, net_worth, breakdown)
           values ($1, '2026-03-02', 500, 0, 500, '{}'::jsonb)`,
          [householdOrg],
        ),
      ).rejects.toThrow();
    });
  });
});
