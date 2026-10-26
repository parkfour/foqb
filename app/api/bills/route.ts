import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createBill, type BillInput } from "@/lib/ar/create-bill";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Partial<BillInput>;
  const { organization_id, vendor_id, bill_number, bill_date, lines } = body;

  if (
    !organization_id ||
    !vendor_id ||
    !bill_number ||
    !bill_date ||
    !Array.isArray(lines) ||
    lines.length === 0
  ) {
    return NextResponse.json(
      { error: "vendor, bill number, bill date, and at least one line are required" },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("id")
    .eq("organization_id", organization_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await createBill(supabase, body as BillInput, user.id);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ success: true, id: result.id, journal_entry_id: result.journalEntryId });
}
