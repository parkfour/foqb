import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/org/current";
import { journalEntriesToCsv, type ExportableJournalLine } from "@/lib/csv/journal-entries";

interface JournalLineWithAccount {
  debit: number;
  credit: number;
  accounts: { account_number: string } | null;
}

interface JournalEntryWithLines {
  id: string;
  entry_date: string;
  memo: string | null;
  journal_lines: JournalLineWithAccount[];
}

export async function GET() {
  const orgId = await getCurrentOrgId();

  if (!orgId) {
    return NextResponse.json({ error: "No organization found" }, { status: 404 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("journal_entries")
    .select("id, entry_date, memo, journal_lines(debit, credit, accounts(account_number))")
    .eq("organization_id", orgId)
    .eq("status", "posted")
    .order("entry_date");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Supabase's untyped client infers embedded to-one relations as arrays
  // when no generated Database schema is provided; at runtime PostgREST
  // returns a single object here since journal_lines.account_id -> accounts
  // is many-to-one. Bridge through unknown to assert the real shape.
  const entries = (data as unknown as JournalEntryWithLines[] | null) ?? [];

  const rows: ExportableJournalLine[] = entries.flatMap((entry) =>
    (entry.journal_lines ?? []).map((line) => ({
      entry_ref: entry.id,
      entry_date: entry.entry_date,
      memo: entry.memo,
      account_number: line.accounts?.account_number ?? "",
      debit: Number(line.debit),
      credit: Number(line.credit),
    })),
  );

  const csv = journalEntriesToCsv(rows);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="journal-entries.csv"',
    },
  });
}
