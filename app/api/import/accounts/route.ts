import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/org/current";
import { parseAccountsCsv } from "@/lib/csv/accounts";

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
  const { records, errors } = parseAccountsCsv(csvText);

  const supabase = await createClient();

  if (dryRun) {
    // Preview without writing: the most common real failure (seen against
    // adversarial data) is a duplicate account_number, either against what's
    // already in the org or repeated within the file itself.
    const { data: existingAccounts } = await supabase
      .from("accounts")
      .select("account_number")
      .eq("organization_id", orgId);

    const existingNumbers = new Set(
      ((existingAccounts as { account_number: string }[] | null) ?? []).map(
        (a) => a.account_number,
      ),
    );
    const seenInFile = new Set<string>();
    const previewErrors = [...errors];
    let wouldImport = 0;

    for (const record of records) {
      if (existingNumbers.has(record.account_number) || seenInFile.has(record.account_number)) {
        previewErrors.push(`${record.account_number}: already exists or duplicated in file`);
        continue;
      }
      seenInFile.add(record.account_number);
      wouldImport += 1;
    }

    return NextResponse.json({
      success: true,
      dryRun: true,
      imported: wouldImport,
      errors: previewErrors,
    });
  }

  let imported = 0;
  const importErrors: string[] = [...errors];

  for (const record of records) {
    const { error } = await supabase.from("accounts").insert({
      organization_id: orgId,
      account_number: record.account_number,
      name: record.name,
      type: record.type,
      description: record.description,
      is_active: record.is_active,
    });

    if (error) {
      importErrors.push(`${record.account_number}: ${error.message}`);
    } else {
      imported += 1;
    }
  }

  return NextResponse.json({ success: true, dryRun: false, imported, errors: importErrors });
}
