import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { Client } from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addMember, createAccount, createOrg, createUser, newId } from "./helpers";
import { removeBooks, restClientAs } from "./rest";
import { scheduledBalance } from "@/plugins/mortgage-notes/schedule";

// The actions, signed in through supabase-js against the real schema.
let currentClient: SupabaseClient;
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => currentClient }));
vi.mock("@/lib/org/current", () => ({ getCurrentUserRole: async () => "owner", canWrite: () => true }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { createNote, updateNote, get1098, getNotes } = await import("@/plugins/mortgage-notes/actions");
type NoteInput = Parameters<typeof createNote>[1];

describe("mortgage notes", () => {
  let client: Client;
  const orgIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    client = new Client({ connectionString: inject("databaseUrl") });
    await client.connect();
  });

  afterAll(async () => {
    await removeBooks(client, orgIds, userIds);
    await client.end();
  });

  // A book with a checking account where the borrower's payments arrive:
  // one from before the books take the note up, and two after.
  async function book() {
    const userId = await createUser(client, `lender-${newId()}@example.com`);
    const orgId = await createOrg(client, "Lender Book");
    await addMember(client, orgId, userId, "owner");
    orgIds.push(orgId);
    userIds.push(userId);
    const checking = await createAccount(client, orgId, { name: "Checking", type: "asset", accountNumber: "1000" });
    await createAccount(client, orgId, { name: "Opening Equity", type: "equity", accountNumber: "3000" });
    for (const [date, ref] of [["2025-12-15", "dec"], ["2026-01-15", "jan"], ["2026-02-15", "feb"]]) {
      await client.query(
        `insert into bank_transactions (organization_id, account_id, external_transaction_id, date, name, amount)
         values ($1, $2, $3, $4, 'ZELLE FROM PAT BORROWER', 799.55)`,
        [orgId, checking, `${orgId}:${ref}`, date],
      );
    }
    currentClient = restClientAs(userId);
    return { orgId };
  }

  const input = (overrides: Partial<NoteInput> = {}): NoteInput => ({
    name: "Elm St",
    borrowerName: "Pat Borrower",
    borrowerAddress: "",
    borrowerTin: "",
    lenderName: "",
    lenderAddress: "",
    lenderTin: "",
    propertyAddress: "",
    originationDate: "2024-01-01",
    originalPrincipal: 100000,
    annualRate: 6,
    termMonths: 360,
    firstPaymentDate: "2024-02-01",
    paymentAmount: 599.55,
    escrowAmount: 200,
    matchText: "PAT BORROWER",
    balanceAsOf: "2026-01-01",
    balance: 97000,
    ...overrides,
  });

  async function noteId(orgId: string) {
    return (await client.query("select id from mortgage_notes where organization_id = $1", [orgId])).rows[0].id as string;
  }

  // Each booked payment's lines off the checking account, by account name.
  async function splits(orgId: string) {
    const { rows } = await client.query(
      `select bt.date::text, a.name, jl.credit::float as amount
         from bank_transactions bt
         join journal_lines jl on jl.journal_entry_id = bt.journal_entry_id
         join accounts a on a.id = jl.account_id
        where bt.organization_id = $1 and bt.status = 'matched' and jl.credit > 0
        order by bt.date, a.name`,
      [orgId],
    );
    return rows;
  }

  it("opens the note at what was owed, and splits the payments since into interest, escrow and principal", async () => {
    const { orgId } = await book();

    expect(await createNote(orgId, input())).toEqual({ success: true, booked: 2 });

    expect(await splits(orgId)).toEqual([
      { date: "2026-01-15", name: "Escrow held: Elm St", amount: 200 },
      { date: "2026-01-15", name: "Mortgage interest: Elm St", amount: 485 },
      { date: "2026-01-15", name: "Note receivable: Elm St", amount: 114.55 },
      // Interest on what the January payment left: 96,885.45.
      { date: "2026-02-15", name: "Escrow held: Elm St", amount: 200 },
      { date: "2026-02-15", name: "Mortgage interest: Elm St", amount: 484.43 },
      { date: "2026-02-15", name: "Note receivable: Elm St", amount: 115.12 },
    ]);
    // December's payment is in the opening balance already; it's left to the rules.
    const dec = await client.query("select status from bank_transactions where organization_id = $1 and external_transaction_id = $2", [orgId, `${orgId}:dec`]);
    expect(dec.rows[0].status).toBe("unreconciled");
    expect((await getNotes(orgId))?.[0].balance).toBe(96770.33);
  });

  it("re-splits the booked payments on new terms", async () => {
    const { orgId } = await book();
    await createNote(orgId, input());

    const result = await updateNote(orgId, await noteId(orgId), input({ annualRate: 5 }));

    expect(result).toEqual({ success: true, booked: 2, kept: 0 });
    const interest = (await splits(orgId)).filter((s) => s.name.startsWith("Mortgage interest"));
    // 97,000 at 5%, then 96,804.62 at 5%.
    expect(interest.map((s) => s.amount)).toEqual([404.17, 403.35]);
    const { rows } = await client.query(
      "select count(*)::int as n from journal_entries where organization_id = $1 and memo = 'Opening balance' and status = 'posted'",
      [orgId],
    );
    expect(rows[0].n).toBe(1);
  });

  it("keeps a payment a reconciliation holds when the terms change", async () => {
    const { orgId } = await book();
    await createNote(orgId, input());
    const { rows: rec } = await client.query(
      `insert into bank_reconciliations (organization_id, account_id, statement_date, statement_ending_balance)
       select $1, account_id, '2026-01-31', 0 from bank_transactions where organization_id = $1 and external_transaction_id = $2 returning id`,
      [orgId, `${orgId}:jan`],
    );
    await client.query(
      `update journal_lines set reconciliation_id = $2 where journal_entry_id =
         (select journal_entry_id from bank_transactions where organization_id = $1 and external_transaction_id = $3)`,
      [orgId, rec[0].id, `${orgId}:jan`],
    );

    const result = await updateNote(orgId, await noteId(orgId), input({ annualRate: 5 }));

    expect(result).toMatchObject({ success: true, kept: 1 });
    const interest = (await splits(orgId)).filter((s) => s.name.startsWith("Mortgage interest"));
    // January stays reconciled at 6%; February is re-split at 5% on 96,885.45.
    expect(interest.map((s) => s.amount)).toEqual([485, 403.69]);
  });

  it("reports the year's interest, principal and escrow for the 1098", async () => {
    const { orgId } = await book();
    await createNote(orgId, input());

    const report = await get1098(orgId, await noteId(orgId), 2026);

    expect(report).toMatchObject({
      year: 2026,
      interestReceived: 969.43,
      principalReceived: 229.67,
      escrowReceived: 400,
      escrowPaidOut: 0,
      originationDate: "2024-01-01",
      // The books start in 2026, so January 1's balance is the schedule's.
      principalOutstanding: scheduledBalance(
        { originalPrincipal: 100000, annualRate: 6, paymentAmount: 599.55, firstPaymentDate: "2024-02-01" },
        "2025-12-31",
      ),
    });
  });
});
