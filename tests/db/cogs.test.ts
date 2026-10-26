import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { addMember, asUser, createAccount, createOrg, createUser, newId } from "./helpers";

describe("inventory moves and item stock (20260101000086)", () => {
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

  it("counts moves of posted entries only, so voiding the sale puts the stock back", async () => {
    const org = await createOrg(client);
    const user = await createUser(client, "stock@example.com");
    await addMember(client, org, user, "owner");
    const sales = await createAccount(client, org, { type: "revenue", name: "Sales" });
    const inventory = await createAccount(client, org, { type: "asset", name: "Inventory" });
    const cogs = await createAccount(client, org, { type: "expense", name: "COGS" });
    const item = newId();
    await client.query(
      "insert into items (id, organization_id, name, income_account_id, track_quantity, quantity_on_hand, inventory_account_id, cogs_account_id, unit_cost) values ($1, $2, 'Widget', $3, true, 10, $4, $5, 2)",
      [item, org, sales, inventory, cogs],
    );
    const entry = newId();
    await client.query("insert into journal_entries (id, organization_id, entry_date, status) values ($1, $2, '2026-10-01', 'draft')", [entry, org]);
    await client.query(
      "insert into journal_lines (journal_entry_id, account_id, debit, credit) values ($1, $2, 6, 0), ($1, $3, 0, 6)",
      [entry, cogs, inventory],
    );
    await client.query("update journal_entries set status = 'posted' where id = $1", [entry]);

    await asUser(client, user);
    await client.query("insert into inventory_moves (organization_id, item_id, journal_entry_id, quantity, unit_cost) values ($1, $2, $3, -3, 2)", [org, item, entry]);
    const onHand = async () => (await client.query("select on_hand::float from item_stock where item_id = $1", [item])).rows[0].on_hand;
    expect(await onHand()).toBe(7);

    await client.query("update journal_entries set status = 'void' where id = $1", [entry]);
    expect(await onHand()).toBe(10);
  });

  it("refuses another book's account as an item's inventory account", async () => {
    const org = await createOrg(client);
    const other = await createOrg(client, "Other");
    const sales = await createAccount(client, org, { type: "revenue", name: "Sales" });
    const theirs = await createAccount(client, other, { type: "asset", name: "Their inventory" });
    await client.query("SAVEPOINT s");
    await expect(
      client.query("insert into items (organization_id, name, income_account_id, inventory_account_id) values ($1, 'X', $2, $3)", [org, sales, theirs]),
    ).rejects.toThrow(/same organization/);
    await client.query("ROLLBACK TO SAVEPOINT s");
  });

  it("restores stock accounts, bill line items and moves (20260101000096)", async () => {
    const orgId = newId();
    const [sales, inventory, cogs, ap, vendor, item, bill, entry] = Array.from({ length: 8 }, newId);
    const snapshot = {
      organization: { id: orgId, name: "Restored Stock" },
      accounts: [
        { id: sales, organization_id: orgId, account_number: "4000", name: "Sales", type: "revenue", is_active: true },
        { id: inventory, organization_id: orgId, account_number: "1300", name: "Inventory", type: "asset", is_active: true },
        { id: cogs, organization_id: orgId, account_number: "5000", name: "COGS", type: "expense", is_active: true },
        { id: ap, organization_id: orgId, account_number: "2000", name: "Accounts Payable", type: "liability", is_active: true },
      ],
      vendors: [{ id: vendor, organization_id: orgId, name: "Supplier", is_active: true }],
      items: [{ id: item, organization_id: orgId, name: "Widget", income_account_id: sales, track_quantity: true, quantity_on_hand: 0,
        is_active: true, inventory_account_id: inventory, cogs_account_id: cogs, unit_cost: 2.5 }],
      journal_entries: [
        { id: entry, organization_id: orgId, entry_date: "2026-10-01", memo: "Bill B-1", status: "posted", journal_lines: [
          { id: newId(), journal_entry_id: entry, account_id: inventory, debit: 10, credit: 0 },
          { id: newId(), journal_entry_id: entry, account_id: ap, debit: 0, credit: 10 },
        ] },
      ],
      bills: [{ id: bill, organization_id: orgId, vendor_id: vendor, bill_number: "B-1", bill_date: "2026-10-01", status: "open",
        journal_entry_id: entry, bill_lines: [{ id: newId(), bill_id: bill, account_id: inventory, quantity: 4, unit_price: 2.5, amount: 10, item_id: item }] }],
      inventory_moves: [{ id: newId(), item_id: item, journal_entry_id: entry, quantity: 4, unit_cost: 2.5 }],
      customers: [], invoices: [], invoice_payments: [], bill_payments: [], inventory_items: [], fixed_assets: [], recurring_invoices: [],
      recurring_bills: [], bank_transactions: [], bank_reconciliations: [], categorization_rules: [],
    };

    await asUser(client, await createUser(client, "stock-restorer@example.com"));
    await client.query("select restore_organization($1)", [JSON.stringify(snapshot)]);
    await client.query("RESET ROLE");

    expect((await client.query("select cogs_account_id, unit_cost::float from items where id = $1", [item])).rows).toEqual([{ cogs_account_id: cogs, unit_cost: 2.5 }]);
    expect((await client.query("select item_id from bill_lines where bill_id = $1", [bill])).rows).toEqual([{ item_id: item }]);
    expect((await client.query("select on_hand::float from item_stock where item_id = $1", [item])).rows).toEqual([{ on_hand: 4 }]);
  });
});
