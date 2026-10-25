import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { addMember, asUser, createAccount, createOrg, createUser, newId } from "./helpers";

describe("household budgets and backups", () => {
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

  const insertBudget =
    "insert into monthly_budgets (organization_id, account_id, year_month, budgeted_amount) values ($1, $2, $3, 500)";

  it("lets writers set budgets but not viewers", async () => {
    const org = await createOrg(client, "Budget Household");
    const viewer = await createUser(client, "budget-viewer@example.com");
    const writer = await createUser(client, "budget-writer@example.com");
    await addMember(client, org, viewer, "viewer");
    await addMember(client, org, writer, "accountant");
    const groceries = await createAccount(client, org, { accountNumber: "6000", name: "Groceries", type: "expense" });

    await asUser(client, viewer);
    await refused(insertBudget, [org, groceries, "2026-10"], /row-level security/);

    await client.query("RESET ROLE");
    await asUser(client, writer);
    await client.query(insertBudget, [org, groceries, "2026-10"]);
  });

  it("refuses another organization's account and a malformed month", async () => {
    const org = await createOrg(client, "Mine");
    const other = await createOrg(client, "Theirs");
    const mine = await createAccount(client, org, { accountNumber: "6000", name: "Groceries", type: "expense" });
    const theirs = await createAccount(client, other, { accountNumber: "6000", name: "Groceries", type: "expense" });

    await refused(insertBudget, [org, theirs, "2026-10"], /organization/i);
    await refused(insertBudget, [org, mine, "2026-13"], /check constraint/);
  });

  it("restores a household backup with its properties, budgets, history, cleared marks, rules and plugin data", async () => {
    const orgId = newId();
    const home = newId();
    const cash = newId();
    const groceries = newId();
    const entryId = newId();
    const cashLine = newId();
    const bankTx = newId();
    const snapshot = {
      organization: { id: orgId, name: "Restored Household", workspace_type: "household" },
      accounts: [
        { id: cash, organization_id: orgId, account_number: "1000", name: "Checking", type: "asset", is_active: true },
        { id: groceries, organization_id: orgId, account_number: "6000", name: "Groceries", type: "expense", is_active: true, property_id: home, budget_rollover: true },
      ],
      journal_entries: [
        {
          id: entryId, organization_id: orgId, entry_date: "2026-10-02", memo: "Market", status: "posted",
          journal_lines: [
            { id: newId(), journal_entry_id: entryId, account_id: groceries, debit: 40, credit: 0 },
            { id: cashLine, journal_entry_id: entryId, account_id: cash, debit: 0, credit: 40, cleared: true },
          ],
        },
      ],
      bank_transactions: [
        { id: bankTx, organization_id: orgId, account_id: cash, external_transaction_id: "t-1", date: "2026-10-02",
          name: "Market", amount: -40, status: "matched", journal_entry_id: entryId, cleared: true },
      ],
      properties: [{ id: home, name: "Home", purchase_price: 300000, estimated_value: 350000 }],
      monthly_budgets: [{ id: newId(), account_id: groceries, year_month: "2026-10", budgeted_amount: 400 }],
      net_worth_snapshots: [
        { id: newId(), date: "2026-10-01", total_assets: 350000, total_liabilities: 0, net_worth: 350000, breakdown: {} },
      ],
      customers: [], vendors: [], invoices: [], bills: [], invoice_payments: [], bill_payments: [], items: [],
      inventory_items: [], fixed_assets: [], recurring_invoices: [], recurring_bills: [],
      bank_reconciliations: [],
      categorization_rules: [
        { id: newId(), target_account_id: groceries, bank_account_id: cash, rule_name: "Market", match_type: "contains",
          match_text: "Market", transaction_type: "any", priority: 10, is_active: true },
      ],
      plugin_data: [{ id: newId(), plugin_id: "example", key: "settings", value: { year: 2026 } }],
    };

    const user = await createUser(client, "household-restorer@example.com");
    await asUser(client, user);
    await client.query("select restore_organization($1)", [JSON.stringify(snapshot)]);
    await client.query("RESET ROLE");

    const one = async (sql: string) => (await client.query(sql, [orgId])).rows[0];
    expect(await one("select workspace_type from organizations where id = $1")).toEqual({ workspace_type: "household" });
    expect(await one("select estimated_value::text as v from properties where organization_id = $1")).toEqual({ v: "350000.00" });
    expect(await one("select budgeted_amount::text as v from monthly_budgets where organization_id = $1")).toEqual({ v: "400.00" });
    expect(await one("select count(*)::int as n from net_worth_snapshots where organization_id = $1")).toEqual({ n: 1 });
    expect((await client.query("select cleared from journal_lines where id = $1", [cashLine])).rows[0]).toEqual({ cleared: true });
    expect((await client.query("select cleared from bank_transactions where id = $1", [bankTx])).rows[0]).toEqual({ cleared: true });
    expect((await client.query("select property_id, budget_rollover from accounts where id = $1", [groceries])).rows[0]).toEqual({
      property_id: home,
      budget_rollover: true,
    });
    expect(await one("select bank_account_id from categorization_rules where organization_id = $1")).toEqual({ bank_account_id: cash });
    expect(await one("select value from plugin_data where organization_id = $1")).toEqual({ value: { year: 2026 } });
  });
});
