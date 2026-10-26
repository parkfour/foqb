import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { addMember, asUser, createAccount, createOrg, createUser, newId } from "./helpers";

describe("investments (20260101000094)", () => {
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

  async function fails(sql: string, params: unknown[]): Promise<string> {
    await client.query("SAVEPOINT attempt");
    try {
      await client.query(sql, params);
      return "";
    } catch (err) {
      return (err as Error).message;
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT attempt");
    }
  }

  const trade =
    "insert into investment_trades (organization_id, account_id, security_id, trade_date, kind, quantity, price) values ($1, $2, $3, '2026-01-02', 'buy', 10, 200)";

  it("lets writers record trades in their own accounts, refuses viewers and other books' securities", async () => {
    const org = await createOrg(client);
    const other = await createOrg(client, "Other");
    const owner = await createUser(client, "inv-owner@example.com");
    const viewer = await createUser(client, "inv-viewer@example.com");
    await addMember(client, org, owner, "owner");
    await addMember(client, org, viewer, "viewer");
    const ira = await createAccount(client, org, { type: "asset", name: "IRA" });
    const [vti, theirs] = [newId(), newId()];
    await client.query("insert into securities (id, organization_id, symbol) values ($1, $2, 'THEIRS')", [theirs, other]);

    await asUser(client, owner);
    await client.query("insert into securities (id, organization_id, symbol) values ($1, $2, 'VTI')", [vti, org]);
    await client.query(trade, [org, ira, vti]);
    expect(await fails(trade, [org, ira, theirs])).toMatch(/same organization/);
    expect(await fails("insert into securities (organization_id, symbol) values ($1, 'bad symbol')", [org])).toMatch(/check constraint/);
    await client.query("insert into security_prices (organization_id, security_id, price_date, price) values ($1, $2, '2026-10-01', 250)", [org, vti]);
    expect(await fails("insert into security_prices (organization_id, security_id, price_date, price) values ($1, $2, '2026-10-01', 251)", [org, vti])).toMatch(
      /duplicate key/,
    );

    await client.query("RESET ROLE");
    await asUser(client, viewer);
    expect((await client.query("select quantity::float from investment_trades")).rows).toEqual([{ quantity: 10 }]);
    expect(await fails(trade, [org, ira, vti])).toMatch(/row-level security/);
  });

  it("restores securities, prices and trades", async () => {
    const orgId = newId();
    const [ira, vti] = [newId(), newId()];
    const snapshot = {
      organization: { id: orgId, name: "Restored Portfolio" },
      accounts: [{ id: ira, organization_id: orgId, account_number: "1500", name: "IRA", type: "asset", is_active: true }],
      securities: [{ id: vti, symbol: "VTI", name: "Total market" }],
      security_prices: [{ id: newId(), security_id: vti, price_date: "2026-10-01", price: 250, source: "Entered" }],
      investment_trades: [{ id: newId(), account_id: ira, security_id: vti, trade_date: "2026-01-02", kind: "buy", quantity: 10, price: 200, fees: 5 }],
      journal_entries: [], customers: [], vendors: [], invoices: [], bills: [], invoice_payments: [], bill_payments: [], items: [],
      inventory_items: [], fixed_assets: [], recurring_invoices: [], recurring_bills: [], bank_transactions: [], bank_reconciliations: [],
      categorization_rules: [],
    };
    await asUser(client, await createUser(client, "inv-restorer@example.com"));
    await client.query("select restore_organization($1)", [JSON.stringify(snapshot)]);
    await client.query("RESET ROLE");
    expect((await client.query("select quantity::float, fees::float from investment_trades where organization_id = $1", [orgId])).rows).toEqual([
      { quantity: 10, fees: 5 },
    ]);
    expect((await client.query("select price::float from security_prices where organization_id = $1", [orgId])).rows).toEqual([{ price: 250 }]);
  });
});
