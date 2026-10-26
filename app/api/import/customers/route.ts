import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { emitHook } from "@/lib/plugins/hooks";
import { ensureServerPluginsLoaded } from "@/lib/plugins/server-loader";
import { getCurrentOrgId } from "@/lib/org/current";
import { parseCustomersCsv } from "@/lib/csv/customers";

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
  const { records, errors } = parseCustomersCsv(csvText);

  const supabase = await createClient();

  // No natural business key on customers (unlike accounts' account_number),
  // so name is the closest thing to one — dedupe against it the same way.
  const { data: existingCustomers } = await supabase
    .from("customers")
    .select("name")
    .eq("organization_id", orgId);

  const existingNames = new Set(
    ((existingCustomers as { name: string }[] | null) ?? []).map((c) => c.name),
  );
  const seenInFile = new Set<string>();
  const validatedErrors: string[] = [...errors];
  const validRecords: typeof records = [];

  for (const record of records) {
    if (existingNames.has(record.name) || seenInFile.has(record.name)) {
      validatedErrors.push(`${record.name}: already exists or duplicated in file`);
      continue;
    }
    seenInFile.add(record.name);
    validRecords.push(record);
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

  for (const record of validRecords) {
    const { data: created, error } = await supabase.from("customers").insert({
      organization_id: orgId,
      name: record.name,
      email: record.email,
      phone: record.phone,
      billing_address: record.billing_address,
      is_active: record.is_active,
    }).select("id").single();

    if (error) {
      importErrors.push(`${record.name}: ${error.message}`);
    } else {
      imported += 1;
      ensureServerPluginsLoaded();
      await emitHook("customer:created", { customerId: created.id as string, name: record.name, email: record.email ?? null, orgId });
    }
  }

  return NextResponse.json({ success: true, dryRun: false, imported, errors: importErrors });
}
