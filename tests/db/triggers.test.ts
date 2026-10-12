import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { createAccount, createOrg, newId } from "./helpers";

describe("journal entry triggers", () => {
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

  describe("verify_journal_entry_balance", () => {
    it("blocks posting an entry with no lines", async () => {
      const orgId = await createOrg(client);
      const entryId = newId();
      await client.query(
        "insert into journal_entries (id, organization_id, entry_date, status) values ($1, $2, current_date, 'draft')",
        [entryId, orgId],
      );

      await expect(
        client.query("update journal_entries set status = 'posted' where id = $1", [entryId]),
      ).rejects.toThrow(/total debits are zero/i);
    });

    it("blocks posting an entry where debits and credits don't balance", async () => {
      const orgId = await createOrg(client);
      const cash = await createAccount(client, orgId, { accountNumber: "1000", type: "asset" });
      const revenue = await createAccount(client, orgId, {
        accountNumber: "4000",
        type: "revenue",
      });
      const entryId = newId();

      await client.query(
        "insert into journal_entries (id, organization_id, entry_date, status) values ($1, $2, current_date, 'draft')",
        [entryId, orgId],
      );
      await client.query(
        "insert into journal_lines (journal_entry_id, account_id, debit, credit) values ($1, $2, 100, 0)",
        [entryId, cash],
      );
      await client.query(
        "insert into journal_lines (journal_entry_id, account_id, debit, credit) values ($1, $2, 0, 90)",
        [entryId, revenue],
      );

      await expect(
        client.query("update journal_entries set status = 'posted' where id = $1", [entryId]),
      ).rejects.toThrow(/do not equal credits/i);
    });

    it("allows posting a balanced entry", async () => {
      const orgId = await createOrg(client);
      const cash = await createAccount(client, orgId, { accountNumber: "1000", type: "asset" });
      const revenue = await createAccount(client, orgId, {
        accountNumber: "4000",
        type: "revenue",
      });
      const entryId = newId();

      await client.query(
        "insert into journal_entries (id, organization_id, entry_date, status) values ($1, $2, current_date, 'draft')",
        [entryId, orgId],
      );
      await client.query(
        "insert into journal_lines (journal_entry_id, account_id, debit, credit) values ($1, $2, 100, 0)",
        [entryId, cash],
      );
      await client.query(
        "insert into journal_lines (journal_entry_id, account_id, debit, credit) values ($1, $2, 0, 100)",
        [entryId, revenue],
      );

      await client.query("update journal_entries set status = 'posted' where id = $1", [entryId]);

      const { rows } = await client.query("select status from journal_entries where id = $1", [
        entryId,
      ]);
      expect(rows[0].status).toBe("posted");
    });
  });

  describe("void workflow", () => {
    it("allows voiding a posted entry without re-checking balance", async () => {
      const orgId = await createOrg(client);
      const cash = await createAccount(client, orgId, { accountNumber: "1000", type: "asset" });
      const revenue = await createAccount(client, orgId, { accountNumber: "4000", type: "revenue" });
      const entryId = newId();

      await client.query(
        "insert into journal_entries (id, organization_id, entry_date, status) values ($1, $2, current_date, 'draft')",
        [entryId, orgId],
      );
      await client.query(
        "insert into journal_lines (journal_entry_id, account_id, debit, credit) values ($1, $2, 50, 0)",
        [entryId, cash],
      );
      await client.query(
        "insert into journal_lines (journal_entry_id, account_id, debit, credit) values ($1, $2, 0, 50)",
        [entryId, revenue],
      );
      await client.query("update journal_entries set status = 'posted' where id = $1", [entryId]);

      await expect(
        client.query("update journal_entries set status = 'void' where id = $1", [entryId]),
      ).resolves.toBeDefined();

      const { rows } = await client.query("select status from journal_entries where id = $1", [
        entryId,
      ]);
      expect(rows[0].status).toBe("void");
    });

    it("excludes voided entries from the trial balance", async () => {
      const orgId = await createOrg(client);
      const cash = await createAccount(client, orgId, { accountNumber: "1000", type: "asset" });
      const revenue = await createAccount(client, orgId, { accountNumber: "4000", type: "revenue" });
      const entryId = newId();

      await client.query(
        "insert into journal_entries (id, organization_id, entry_date, status) values ($1, $2, current_date, 'draft')",
        [entryId, orgId],
      );
      await client.query(
        "insert into journal_lines (journal_entry_id, account_id, debit, credit) values ($1, $2, 75, 0)",
        [entryId, cash],
      );
      await client.query(
        "insert into journal_lines (journal_entry_id, account_id, debit, credit) values ($1, $2, 0, 75)",
        [entryId, revenue],
      );
      await client.query("update journal_entries set status = 'posted' where id = $1", [entryId]);
      await client.query("update journal_entries set status = 'void' where id = $1", [entryId]);

      const { rows } = await client.query(
        "select * from get_trial_balance($1, current_date)",
        [orgId],
      );
      const cashRow = rows.find((r) => r.account_id === cash);
      expect(Number(cashRow.balance)).toBe(0);
    });

    it("blocks voiding an entry dated within a locked period", async () => {
      const orgId = await createOrg(client);
      const cash = await createAccount(client, orgId, { accountNumber: "1000", type: "asset" });
      const revenue = await createAccount(client, orgId, { accountNumber: "4000", type: "revenue" });
      const entryId = newId();

      await client.query(
        "insert into journal_entries (id, organization_id, entry_date, status) values ($1, $2, '2026-01-15', 'draft')",
        [entryId, orgId],
      );
      await client.query(
        "insert into journal_lines (journal_entry_id, account_id, debit, credit) values ($1, $2, 20, 0)",
        [entryId, cash],
      );
      await client.query(
        "insert into journal_lines (journal_entry_id, account_id, debit, credit) values ($1, $2, 0, 20)",
        [entryId, revenue],
      );
      await client.query("update journal_entries set status = 'posted' where id = $1", [entryId]);
      await client.query("update organizations set period_lock_date = '2026-01-31' where id = $1", [
        orgId,
      ]);

      await expect(
        client.query("update journal_entries set status = 'void' where id = $1", [entryId]),
      ).rejects.toThrow(/locked period/i);
    });
  });

  describe("enforce_period_lock", () => {
    it("blocks inserting an entry dated on or before the lock date", async () => {
      const orgId = await createOrg(client);
      await client.query("update organizations set period_lock_date = '2026-01-31' where id = $1", [
        orgId,
      ]);

      await expect(
        client.query(
          "insert into journal_entries (organization_id, entry_date, status) values ($1, '2026-01-31', 'draft')",
          [orgId],
        ),
      ).rejects.toThrow(/locked period/i);
    });

    it("allows inserting an entry dated after the lock date", async () => {
      const orgId = await createOrg(client);
      await client.query("update organizations set period_lock_date = '2026-01-31' where id = $1", [
        orgId,
      ]);

      await expect(
        client.query(
          "insert into journal_entries (organization_id, entry_date, status) values ($1, '2026-02-01', 'draft')",
          [orgId],
        ),
      ).resolves.toBeDefined();
    });

    it("blocks deleting an entry dated on or before the lock date", async () => {
      const orgId = await createOrg(client);
      const entryId = newId();
      await client.query(
        "insert into journal_entries (id, organization_id, entry_date, status) values ($1, $2, '2026-01-15', 'draft')",
        [entryId, orgId],
      );
      await client.query("update organizations set period_lock_date = '2026-01-31' where id = $1", [
        orgId,
      ]);

      await expect(
        client.query("delete from journal_entries where id = $1", [entryId]),
      ).rejects.toThrow(/locked period/i);
    });

    it("allows deleting an entry dated after the lock date", async () => {
      const orgId = await createOrg(client);
      const entryId = newId();
      await client.query("update organizations set period_lock_date = '2026-01-31' where id = $1", [
        orgId,
      ]);
      await client.query(
        "insert into journal_entries (id, organization_id, entry_date, status) values ($1, $2, '2026-02-15', 'draft')",
        [entryId, orgId],
      );

      await expect(
        client.query("delete from journal_entries where id = $1", [entryId]),
      ).resolves.toBeDefined();
    });
  });
});
