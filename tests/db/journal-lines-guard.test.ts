import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { addMember, asUser, createAccount, createOrg, createUser, newId } from "./helpers";

describe("journal lines follow their entry's status and the period lock", () => {
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

  // An org with a writer and a posted, balanced entry dated 2026-03-15.
  async function postedEntry() {
    const orgId = await createOrg(client, "Lines Org");
    const writer = await createUser(client, "lines-writer@example.com");
    await addMember(client, orgId, writer, "accountant");
    const cash = await createAccount(client, orgId, { accountNumber: "1000", name: "Cash" });
    const revenue = await createAccount(client, orgId, { accountNumber: "4000", name: "Revenue", type: "revenue" });
    const entryId = newId();
    await client.query(
      "insert into journal_entries (id, organization_id, entry_date, status) values ($1, $2, '2026-03-15', 'draft')",
      [entryId, orgId],
    );
    const debitLine = newId();
    await client.query(
      "insert into journal_lines (id, journal_entry_id, account_id, debit, credit) values ($1, $2, $3, 100, 0), (gen_random_uuid(), $2, $4, 0, 100)",
      [debitLine, entryId, cash, revenue],
    );
    await client.query("update journal_entries set status = 'posted' where id = $1", [entryId]);
    return { orgId, writer, cash, revenue, entryId, debitLine };
  }

  async function refused(sql: string, params: unknown[], pattern: RegExp) {
    await client.query("SAVEPOINT s");
    await expect(client.query(sql, params)).rejects.toThrow(pattern);
    await client.query("ROLLBACK TO SAVEPOINT s");
  }

  it("refuses changing, adding or deleting lines of a posted entry", async () => {
    const { writer, cash, entryId, debitLine } = await postedEntry();
    await asUser(client, writer);

    await refused("update journal_lines set debit = 999 where id = $1", [debitLine], /posted/);
    await refused(
      "insert into journal_lines (journal_entry_id, account_id, debit, credit) values ($1, $2, 5, 0)",
      [entryId, cash],
      /posted/,
    );
    await refused("delete from journal_lines where id = $1", [debitLine], /posted/);
  });

  it("still lets a reconciliation mark posted lines", async () => {
    const { orgId, cash, debitLine } = await postedEntry();
    const reconciliationId = newId();
    await client.query(
      "insert into bank_reconciliations (id, organization_id, account_id, statement_date, statement_ending_balance) values ($1, $2, $3, '2026-03-31', 100)",
      [reconciliationId, orgId, cash],
    );

    await client.query("update journal_lines set reconciliation_id = $1 where id = $2", [reconciliationId, debitLine]);
    await client.query("update journal_lines set reconciliation_id = null where id = $1", [debitLine]);
  });

  it("refuses changing lines of a draft entry inside a locked period", async () => {
    const { orgId, cash, entryId, debitLine } = await postedEntry();
    await client.query("update journal_entries set status = 'draft' where id = $1", [entryId]);
    await client.query("update organizations set period_lock_date = '2026-03-31' where id = $1", [orgId]);

    await refused("update journal_lines set debit = 50 where id = $1", [debitLine], /locked period/);
    await refused(
      "insert into journal_lines (journal_entry_id, account_id, debit, credit) values ($1, $2, 5, 0)",
      [entryId, cash],
      /locked period/,
    );
  });

  it("still allows draft lines to be edited, and deleting a whole draft entry", async () => {
    const { entryId, debitLine } = await postedEntry();
    await client.query("update journal_entries set status = 'draft' where id = $1", [entryId]);

    await client.query("update journal_lines set debit = 100, description = 'edited' where id = $1", [debitLine]);
    await client.query("delete from journal_entries where id = $1", [entryId]);
  });

  it("still allows deleting a whole posted entry outside the locked period", async () => {
    const { entryId } = await postedEntry();
    await client.query("delete from journal_entries where id = $1", [entryId]);
    const { rows } = await client.query("select count(*)::int as n from journal_lines where journal_entry_id = $1", [entryId]);
    expect(rows[0].n).toBe(0);
  });

  it("restores a backup whose rows have no created_at", async () => {
    const orgId = newId();
    const cash = newId();
    const revenue = newId();
    const entryId = newId();
    const snapshot = {
      organization: { id: orgId, name: "Sparse" },
      accounts: [
        { id: cash, organization_id: orgId, account_number: "1000", name: "Cash", type: "asset", is_active: true },
        { id: revenue, organization_id: orgId, account_number: "4000", name: "Revenue", type: "revenue", is_active: true },
      ],
      journal_entries: [
        {
          id: entryId, organization_id: orgId, entry_date: "2026-03-15", memo: "Sale", status: "posted",
          journal_lines: [
            { id: newId(), journal_entry_id: entryId, account_id: cash, debit: 100, credit: 0 },
            { id: newId(), journal_entry_id: entryId, account_id: revenue, debit: 0, credit: 100 },
          ],
        },
      ],
      customers: [{ id: newId(), organization_id: orgId, name: "Bluebird Café", is_active: true }],
      vendors: [], invoices: [], bills: [], invoice_payments: [], bill_payments: [], items: [],
      inventory_items: [], fixed_assets: [], recurring_invoices: [], recurring_bills: [], bank_transactions: [],
      bank_reconciliations: [], categorization_rules: [],
    };

    const user = await createUser(client, "restorer-sparse@example.com");
    await asUser(client, user);
    await client.query("select restore_organization($1)", [JSON.stringify(snapshot)]);
    await client.query("RESET ROLE");

    const { rows } = await client.query("select count(*)::int as n from journal_entries where organization_id = $1 and status = 'posted'", [orgId]);
    expect(rows[0].n).toBe(1);
  });

  it("restores a backup with posted entries and a period lock", async () => {
    const orgId = newId();
    const cash = newId();
    const revenue = newId();
    const entryId = newId();
    const snapshot = {
      organization: { id: orgId, name: "Restored", period_lock_date: "2026-03-31" },
      accounts: [
        { id: cash, organization_id: orgId, account_number: "1000", name: "Cash", type: "asset", is_active: true },
        { id: revenue, organization_id: orgId, account_number: "4000", name: "Revenue", type: "revenue", is_active: true },
      ],
      journal_entries: [
        {
          id: entryId, organization_id: orgId, entry_date: "2026-03-15", memo: "Sale", status: "posted", created_at: "2026-03-15T12:00:00Z",
          journal_lines: [
            { id: newId(), journal_entry_id: entryId, account_id: cash, debit: 100, credit: 0 },
            { id: newId(), journal_entry_id: entryId, account_id: revenue, debit: 0, credit: 100 },
          ],
        },
      ],
      customers: [], vendors: [], invoices: [], bills: [], invoice_payments: [], bill_payments: [], items: [],
      inventory_items: [], fixed_assets: [], recurring_invoices: [], recurring_bills: [], bank_transactions: [],
      bank_reconciliations: [], categorization_rules: [],
    };

    const user = await createUser(client, "restorer-lines@example.com");
    await asUser(client, user);
    await client.query("select restore_organization($1)", [JSON.stringify(snapshot)]);
    await client.query("RESET ROLE");

    const { rows: entries } = await client.query("select status from journal_entries where organization_id = $1", [orgId]);
    expect(entries).toEqual([{ status: "posted" }]);
    const { rows: org } = await client.query("select period_lock_date::text as d from organizations where id = $1", [orgId]);
    expect(org[0].d).toBe("2026-03-31");
  });
});
