import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { addMember, asUser, createAccount, createOrg, createUser, newId } from "./helpers";

async function postEntry(
  client: Client,
  orgId: string,
  entryDate: string,
  accountId: string,
  debit: number,
  credit: number,
  offsetAccountId: string,
): Promise<string> {
  const entryId = newId();
  await client.query(
    "insert into journal_entries (id, organization_id, entry_date, status) values ($1, $2, $3, 'draft')",
    [entryId, orgId, entryDate],
  );
  await client.query(
    "insert into journal_lines (journal_entry_id, account_id, debit, credit) values ($1, $2, $3, $4)",
    [entryId, accountId, debit, credit],
  );
  await client.query(
    "insert into journal_lines (journal_entry_id, account_id, debit, credit) values ($1, $2, $3, $4)",
    [entryId, offsetAccountId, credit, debit],
  );
  await client.query("update journal_entries set status = 'posted' where id = $1", [entryId]);
  return entryId;
}

describe("bank reconciliations", () => {
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

  it("lets a writer create a reconciliation but blocks a viewer", async () => {
    const orgId = await createOrg(client);
    const owner = await createUser(client);
    await addMember(client, orgId, owner, "owner");
    const viewer = await createUser(client);
    await addMember(client, orgId, viewer, "viewer");
    const bankAccount = await createAccount(client, orgId, { type: "asset" });

    await asUser(client, owner);
    await expect(
      client.query(
        "insert into bank_reconciliations (organization_id, account_id, statement_date, statement_ending_balance) values ($1, $2, '2026-06-01', 100)",
        [orgId, bankAccount],
      ),
    ).resolves.toBeDefined();

    await client.query("RESET ROLE");
    await asUser(client, viewer);
    await expect(
      client.query(
        "insert into bank_reconciliations (organization_id, account_id, statement_date, statement_ending_balance) values ($1, $2, '2026-06-01', 100)",
        [orgId, bankAccount],
      ),
    ).rejects.toThrow();
  });

  it("lets a writer clear journal lines by setting reconciliation_id, blocks a viewer", async () => {
    const orgId = await createOrg(client);
    const owner = await createUser(client);
    await addMember(client, orgId, owner, "owner");
    const viewer = await createUser(client);
    await addMember(client, orgId, viewer, "viewer");
    const bankAccount = await createAccount(client, orgId, { type: "asset" });
    const revenueAccount = await createAccount(client, orgId, { type: "revenue" });

    await asUser(client, owner);
    const entryId = await postEntry(client, orgId, "2026-06-01", bankAccount, 200, 0, revenueAccount);
    const { rows: lineRows } = await client.query(
      "select id from journal_lines where journal_entry_id = $1 and account_id = $2",
      [entryId, bankAccount],
    );
    const lineId = lineRows[0].id;

    const { rows: reconRows } = await client.query(
      "insert into bank_reconciliations (organization_id, account_id, statement_date, statement_ending_balance) values ($1, $2, '2026-06-01', 200) returning id",
      [orgId, bankAccount],
    );
    const reconciliationId = reconRows[0].id;

    await expect(
      client.query("update journal_lines set reconciliation_id = $1 where id = $2", [
        reconciliationId,
        lineId,
      ]),
    ).resolves.toBeDefined();

    await client.query(
      "update journal_lines set reconciliation_id = null where id = $1",
      [lineId],
    );

    await client.query("RESET ROLE");
    await asUser(client, viewer);
    // RLS on UPDATE doesn't throw for a row the policy hides — it just
    // matches and updates zero rows.
    const result = await client.query(
      "update journal_lines set reconciliation_id = $1 where id = $2",
      [reconciliationId, lineId],
    );
    expect(result.rowCount).toBe(0);
  });

  it("scopes reconciliation visibility to org members only", async () => {
    const orgId = await createOrg(client);
    const owner = await createUser(client);
    await addMember(client, orgId, owner, "owner");
    const bankAccount = await createAccount(client, orgId, { type: "asset" });
    const outsider = await createUser(client);

    await asUser(client, owner);
    await client.query(
      "insert into bank_reconciliations (organization_id, account_id, statement_date, statement_ending_balance) values ($1, $2, '2026-06-01', 100)",
      [orgId, bankAccount],
    );

    await client.query("RESET ROLE");
    await asUser(client, outsider);
    const { rows } = await client.query("select id from bank_reconciliations where organization_id = $1", [
      orgId,
    ]);
    expect(rows).toHaveLength(0);
  });
});
