import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/org/current";
import { parseItemsCsv } from "@/lib/csv/items";

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
  const { records, errors } = parseItemsCsv(csvText);

  const supabase = await createClient();

  const [{ data: existingItems }, { data: accounts }] = await Promise.all([
    supabase.from("items").select("name").eq("organization_id", orgId),
    supabase.from("accounts").select("id, account_number").eq("organization_id", orgId),
  ]);

  const existingNames = new Set(
    ((existingItems as { name: string }[] | null) ?? []).map((i) => i.name),
  );
  const accountIdByNumber = new Map(
    ((accounts as { id: string; account_number: string }[] | null) ?? []).map((a) => [
      a.account_number,
      a.id,
    ]),
  );

  const seenInFile = new Set<string>();
  const validatedErrors: string[] = [...errors];
  const validRecords: { record: (typeof records)[number]; incomeAccountId: string }[] = [];

  for (const record of records) {
    if (existingNames.has(record.name) || seenInFile.has(record.name)) {
      validatedErrors.push(`${record.name}: already exists or duplicated in file`);
      continue;
    }

    const incomeAccountId = accountIdByNumber.get(record.income_account_number);
    if (!incomeAccountId) {
      validatedErrors.push(
        `${record.name}: unknown income account number "${record.income_account_number}"`,
      );
      continue;
    }

    seenInFile.add(record.name);
    validRecords.push({ record, incomeAccountId });
  }

  if (dryRun) {
    return NextResponse.json({
      success: true,
      dryRun: true,
      imported: validRecords.length,
      errors: validatedErrors,
    });
  }

  let imported = 0;
  const importErrors: string[] = [...validatedErrors];

  for (const { record, incomeAccountId } of validRecords) {
    const { error } = await supabase.from("items").insert({
      organization_id: orgId,
      name: record.name,
      description: record.description,
      income_account_id: incomeAccountId,
      sale_price: record.sale_price,
      track_quantity: record.track_quantity,
      quantity_on_hand: record.quantity_on_hand,
      is_active: record.is_active,
    });

    if (error) {
      importErrors.push(`${record.name}: ${error.message}`);
    } else {
      imported += 1;
    }
  }

  return NextResponse.json({ success: true, dryRun: false, imported, errors: importErrors });
}
