import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createInvoice, type InvoiceInput } from "@/lib/ar/create-invoice";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Partial<InvoiceInput>;
  const { organization_id, customer_id, invoice_number, invoice_date, lines } = body;

  if (
    !organization_id ||
    !customer_id ||
    !invoice_number ||
    !invoice_date ||
    !Array.isArray(lines) ||
    lines.length === 0
  ) {
    return NextResponse.json(
      { error: "customer, invoice number, invoice date, and at least one line are required" },
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

  const result = await createInvoice(supabase, body as InvoiceInput, user.id);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ success: true, id: result.id, journal_entry_id: result.journalEntryId });
}
