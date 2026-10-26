import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createSupabaseMock, ok } from "./supabase-mock";

const { serverClientMock, getCurrentOrgIdMock } = vi.hoisted(() => ({
  serverClientMock: vi.fn(),
  getCurrentOrgIdMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: serverClientMock }));
vi.mock("@/lib/org/current", () => ({ getCurrentOrgId: getCurrentOrgIdMock }));

import { POST } from "@/app/api/import/journal-entries/route";
import { entryFingerprint } from "@/lib/csv/entry-fingerprint";

function makeRequest(csv: string, dryRun = false): NextRequest {
  const formData = new FormData();
  formData.set("file", new File([csv], "import.csv", { type: "text/csv" }));
  if (dryRun) formData.set("dryRun", "true");
  return new NextRequest("http://localhost/api/import/journal-entries", { method: "POST", body: formData });
}

const NATIVE_CSV =
  "entry_ref,entry_date,memo,account_number,debit,credit\n" +
  "e1,2026-01-01,Test,1000,100,0\n" +
  "e1,2026-01-01,Test,4000,0,100\n";

const WAVE_HEADER =
  "Transaction ID,Transaction Date,Account Name,Transaction Description,Transaction Line Description," +
  "Amount (One column), ,Debit Amount (Two Column Approach),Credit Amount (Two Column Approach)," +
  "Other Accounts for this Transaction,Customer,Vendor,Invoice Number,Bill Number,Notes / Memo," +
  "Amount Before Sales Tax,Sales Tax Amount,Sales Tax Name,Transaction Date Added," +
  "Transaction Date Last Modified,Account Group,Account Type,Account ID";

const WAVE_CSV =
  WAVE_HEADER +
  "\n" +
  "t1,2019-01-08,HSBC Personal,QB/Ideal,,157.25,,,157.25,,,,,,,,,,,,Liability,,\n" +
  "t1,2019-01-08,Computer – Software,QB/Ideal,,157.25,,157.25,,,,,,,,,,,,,Expense,,\n";

beforeEach(() => {
  serverClientMock.mockReset();
  getCurrentOrgIdMock.mockReset().mockResolvedValue("org-1");
});

describe("POST /api/import/journal-entries — native format", () => {
  it("still imports unchanged when the header is our native shape", async () => {
    const { client, tables } = createSupabaseMock({
      tables: {
        accounts: { select: ok([{ id: "acc-cash", account_number: "1000", name: "Cash", type: "asset" }, { id: "acc-rev", account_number: "4000", name: "Revenue", type: "revenue" }]) },
        journal_entries: { insert: ok({ id: "je-1" }), update: ok(null) },
        journal_lines: { insert: ok(null) },
      },
    });
    serverClientMock.mockResolvedValue(client);

    const response = await POST(makeRequest(NATIVE_CSV));
    const json = (await response.json()) as { imported: number; errors: string[] };

    expect(json.imported).toBe(1);
    expect(json.errors).toEqual([]);
    expect(tables.accounts.insert).not.toHaveBeenCalled();
  });
});

describe("POST /api/import/journal-entries — importing the same file again", () => {
  it("skips entries an earlier import already booked", async () => {
    const earlier = entryFingerprint({
      ref: "e1",
      entryDate: "2026-01-01",
      memo: "Test",
      lines: [
        { accountNumber: "4000", debit: 0, credit: 100 },
        { accountNumber: "1000", debit: 100, credit: 0 },
      ],
    });
    const { client, tables } = createSupabaseMock({
      tables: {
        accounts: { select: ok([{ id: "acc-cash", account_number: "1000", name: "Cash", type: "asset" }, { id: "acc-rev", account_number: "4000", name: "Revenue", type: "revenue" }]) },
        journal_entries: { select: ok([{ external_id: earlier }]), insert: ok({ id: "je-9" }) },
        journal_lines: { insert: ok(null) },
      },
    });
    serverClientMock.mockResolvedValue(client);

    const json = (await (await POST(makeRequest(NATIVE_CSV))).json()) as { imported: number; skipped: number };

    expect(json).toMatchObject({ imported: 0, skipped: 1 });
    expect(tables.journal_entries.insert).not.toHaveBeenCalled();
  });

  it("tags each new entry with its source and fingerprint", async () => {
    const { client, tables } = createSupabaseMock({
      tables: {
        accounts: { select: ok([{ id: "acc-cash", account_number: "1000", name: "Cash", type: "asset" }, { id: "acc-rev", account_number: "4000", name: "Revenue", type: "revenue" }]) },
        journal_entries: { insert: ok({ id: "je-1" }), update: ok(null) },
        journal_lines: { insert: ok(null) },
      },
    });
    serverClientMock.mockResolvedValue(client);

    await POST(makeRequest(NATIVE_CSV));

    expect(tables.journal_entries.insert).toHaveBeenCalledWith(
      expect.objectContaining({ source: "csv-import", external_id: expect.stringMatching(/^[0-9a-f]{40}$/) }),
    );
  });
});

describe("POST /api/import/journal-entries — Wave format", () => {
  it("auto-creates unmatched accounts by name and imports the entry", async () => {
    const { client, tables } = createSupabaseMock({
      tables: {
        accounts: {
          select: ok([]),
          insert: ok({ id: "created-acc" }),
        },
        journal_entries: { insert: ok({ id: "je-2" }), update: ok(null) },
        journal_lines: { insert: ok(null) },
      },
    });
    serverClientMock.mockResolvedValue(client);

    const response = await POST(makeRequest(WAVE_CSV));
    const json = (await response.json()) as { imported: number; errors: string[] };

    expect(json.errors).toEqual([]);
    expect(json.imported).toBe(1);
    expect(tables.accounts.insert).toHaveBeenCalledWith(
      expect.objectContaining({ name: "HSBC Personal", type: "liability", account_number: "2000" }),
    );
    expect(tables.accounts.insert).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Computer – Software", type: "expense", account_number: "5000" }),
    );
  });

  it("dry-run previews the would-be-created accounts without writing", async () => {
    const { client, tables } = createSupabaseMock({
      tables: {
        accounts: { select: ok([]), insert: ok({ id: "created-acc" }) },
        journal_entries: { select: ok([]) },
      },
    });
    serverClientMock.mockResolvedValue(client);

    const response = await POST(makeRequest(WAVE_CSV, true));
    const json = (await response.json()) as { dryRun: boolean; imported: number; errors: string[] };

    expect(json.dryRun).toBe(true);
    expect(json.imported).toBe(1);
    expect(json.errors).toEqual([]);
    expect(tables.accounts.insert).not.toHaveBeenCalled();
  });

  it("reuses an existing account matched by name instead of creating a duplicate", async () => {
    const { client, tables } = createSupabaseMock({
      tables: {
        accounts: {
          select: ok([{ id: "acc-hsbc", account_number: "2010", name: "HSBC Personal", type: "liability" }]),
          insert: ok({ id: "created-acc" }),
        },
        journal_entries: { insert: ok({ id: "je-3" }), update: ok(null) },
        journal_lines: { insert: ok(null) },
      },
    });
    serverClientMock.mockResolvedValue(client);

    const response = await POST(makeRequest(WAVE_CSV));
    const json = (await response.json()) as { imported: number; errors: string[] };

    expect(json.imported).toBe(1);
    expect(tables.accounts.insert).toHaveBeenCalledTimes(1);
    expect(tables.accounts.insert).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Computer – Software" }),
    );
  });
});
