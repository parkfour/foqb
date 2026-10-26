import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/org/current";
import { parseJournalEntriesCsv, type JournalEntryRecord } from "@/lib/csv/journal-entries";
import { isWaveJournalCsv, parseWaveJournalEntriesCsv } from "@/lib/csv/wave-journal-entries";
import { nextAccountNumbers } from "@/lib/org/account-numbering";
import type { AccountType } from "@/lib/csv/accounts";
import { entryFingerprint } from "@/lib/csv/entry-fingerprint";
import { readAllRows } from "@/lib/supabase/read-all";

// journal_entries.source for entries this importer made (migration 091).
const SOURCE = "csv-import";

export async function POST(req: NextRequest) {
  const orgId = await getCurrentOrgId();

  if (!orgId) {
    return NextResponse.json({ error: "No organization found" }, { status: 404 });
  }

  const formData = await req.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "A CSV file is required" }, { status: 400 });
  }

  const dryRun = formData.get("dryRun") === "true";
  const csvText = await file.text();

  const supabase = await createClient();

  const { data: accountsData } = await supabase
    .from("accounts")
    .select("id, account_number, name, type")
    .eq("organization_id", orgId);

  const accounts = (accountsData as
    | { id: string; account_number: string; name: string; type: AccountType }[]
    | null) ?? [];
  const accountIdByNumber = new Map(accounts.map((a) => [a.account_number, a.id]));

  let entries: JournalEntryRecord[];
  let errors: string[];

  if (isWaveJournalCsv(csvText)) {
    const parsedWave = parseWaveJournalEntriesCsv(csvText);
    errors = parsedWave.errors;

    // Wave identifies accounts by name, not number, and rarely matches an
    // existing chart of accounts exactly — auto-create anything unmatched
    // so a raw Wave export can be imported without preprocessing.
    const numberByName = new Map(accounts.map((a) => [a.name, a.account_number]));

    const namesSeen = new Map<string, AccountType>();
    for (const entry of parsedWave.entries) {
      for (const line of entry.lines) {
        if (!namesSeen.has(line.accountName)) namesSeen.set(line.accountName, line.accountType);
      }
    }

    const missing = [...namesSeen].filter(([name]) => !numberByName.has(name));
    // Read-only: safe to compute in dry-run mode too, so the preview count
    // reflects accounts that would be auto-created, not "unknown account".
    const accountNumbers = await nextAccountNumbers(
      supabase,
      orgId,
      missing.map(([, type]) => type),
    );

    for (const [[name, type], accountNumber] of missing.map((m, i) => [m, accountNumbers[i]] as const)) {
      numberByName.set(name, accountNumber);

      if (dryRun) {
        accountIdByNumber.set(accountNumber, `preview:${accountNumber}`);
        continue;
      }

      const { data: created, error } = await supabase
        .from("accounts")
        .insert({ organization_id: orgId, account_number: accountNumber, name, type, is_active: true })
        .select("id")
        .single();

      if (error || !created) {
        errors.push(`Account "${name}": failed to create (${error?.message ?? "unknown error"})`);
        continue;
      }

      accountIdByNumber.set(accountNumber, created.id);
    }

    entries = parsedWave.entries.map((entry) => ({
      ref: entry.ref,
      entryDate: entry.entryDate,
      memo: entry.memo,
      lines: entry.lines.map((line) => ({
        accountNumber: numberByName.get(line.accountName) ?? line.accountName,
        debit: line.debit,
        credit: line.credit,
      })),
    }));
  } else {
    const parsedNative = parseJournalEntriesCsv(csvText);
    entries = parsedNative.entries;
    errors = parsedNative.errors;
  }

  // The unknown-account check is a read, so it's accurate for both the
  // preview and the real import — only the writes below are skipped in
  // dry-run mode.
  const validatedErrors: string[] = [...errors];
  let wouldImport = 0;
  const validEntries: (JournalEntryRecord & { externalId: string })[] = [];

  // Entries already brought in by an earlier import are skipped.
  const previous = await readAllRows<{ external_id: string }>((from, to) =>
    supabase
      .from("journal_entries")
      .select("external_id")
      .eq("organization_id", orgId)
      .eq("source", SOURCE)
      .order("id")
      .range(from, to),
  );
  const alreadyImported = new Set(previous.map((r) => r.external_id));
  let skipped = 0;

  for (const entry of entries) {
    const externalId = entryFingerprint(entry);
    if (alreadyImported.has(externalId)) {
      skipped += 1;
      continue;
    }
    alreadyImported.add(externalId);

    const missingAccounts = [
      ...new Set(entry.lines.map((l) => l.accountNumber).filter((num) => !accountIdByNumber.has(num))),
    ];

    if (missingAccounts.length > 0) {
      validatedErrors.push(`Entry ${entry.ref}: unknown account number(s) ${missingAccounts.join(", ")}`);
      continue;
    }

    wouldImport += 1;
    validEntries.push({ ...entry, externalId });
  }

  if (dryRun) {
    return NextResponse.json({
      success: true,
      dryRun: true,
      imported: wouldImport,
      skipped,
      errors: validatedErrors,
    });
  }

  let imported = 0;
  const importErrors: string[] = [...validatedErrors];

  for (const entry of validEntries) {
    // Insert as draft first: journal_lines must reference an existing entry
    // id, and the balance-check trigger only allows posting once lines exist.
    const { data: draft, error: entryError } = await supabase
      .from("journal_entries")
      .insert({
        organization_id: orgId,
        entry_date: entry.entryDate,
        memo: entry.memo,
        status: "draft",
        source: SOURCE,
        external_id: entry.externalId,
      })
      .select("id")
      .single();

    if (entryError?.code === "23505") {
      skipped += 1;
      continue;
    }
    if (entryError || !draft) {
      importErrors.push(`Entry ${entry.ref}: ${entryError?.message ?? "failed to create"}`);
      continue;
    }

    const { error: linesError } = await supabase.from("journal_lines").insert(
      entry.lines.map((line) => ({
        journal_entry_id: draft.id,
        account_id: accountIdByNumber.get(line.accountNumber),
        debit: line.debit,
        credit: line.credit,
      })),
    );

    if (linesError) {
      await supabase.from("journal_entries").delete().eq("id", draft.id);
      importErrors.push(`Entry ${entry.ref}: ${linesError.message}`);
      continue;
    }

    const { error: postError } = await supabase
      .from("journal_entries")
      .update({ status: "posted" })
      .eq("id", draft.id);

    if (postError) {
      await supabase.from("journal_entries").delete().eq("id", draft.id);
      importErrors.push(`Entry ${entry.ref}: ${postError.message}`);
      continue;
    }

    imported += 1;
  }

  return NextResponse.json({ success: true, dryRun: false, imported, skipped, errors: importErrors });
}
