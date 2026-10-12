import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/org/current";
import { accountsToCsv, type ExportableAccount } from "@/lib/csv/accounts";

export async function GET() {
  const orgId = await getCurrentOrgId();

  if (!orgId) {
    return NextResponse.json({ error: "No organization found" }, { status: 404 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("accounts")
    .select("account_number, name, type, description, is_active")
    .eq("organization_id", orgId)
    .order("account_number");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const csv = accountsToCsv((data as ExportableAccount[] | null) ?? []);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="accounts.csv"',
    },
  });
}
