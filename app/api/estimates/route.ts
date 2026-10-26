import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { emitHook } from "@/lib/plugins/hooks";
import { ensureServerPluginsLoaded } from "@/lib/plugins/server-loader";
import type { InvoiceInput } from "@/lib/ar/create-invoice";

interface EstimateRequestBody {
  organization_id: string;
  customer_id: string;
  estimate_number: string;
  estimate_date: string;
  expiry_date: string | null;
  tax_rate?: number;
  tax_rate_ids?: string[];
  lines: InvoiceInput["lines"];
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Partial<EstimateRequestBody>;
  const { organization_id, customer_id, estimate_number, estimate_date, expiry_date, lines } = body;

  if (!organization_id || !customer_id || !estimate_number || !estimate_date || !Array.isArray(lines) || lines.length === 0) {
    return NextResponse.json(
      { error: "customer, estimate number, estimate date, and at least one line are required" },
      { status: 400 },
    );
  }
  if (lines.some((l) => !l.account_id || !(Number(l.quantity) * Number(l.unit_price) > 0))) {
    return NextResponse.json({ error: "Every line needs an account and a positive amount" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Row-level security allows only the book's writers to insert.
  const id = randomUUID();
  const { error: estimateError } = await supabase.from("estimates").insert({
    id,
    organization_id,
    customer_id,
    estimate_number,
    estimate_date,
    expiry_date: expiry_date || null,
    tax_rate: Number(body.tax_rate) || 0,
    tax_rate_ids: Array.isArray(body.tax_rate_ids) ? [...new Set(body.tax_rate_ids)] : [],
  });
  if (estimateError) {
    return NextResponse.json({ error: estimateError.message }, { status: 400 });
  }

  const { error: linesError } = await supabase.from("estimate_lines").insert(
    lines.map((l) => ({
      organization_id,
      estimate_id: id,
      item_id: l.item_id ?? null,
      account_id: l.account_id,
      description: l.description ?? "",
      quantity: l.quantity,
      unit_price: l.unit_price,
    })),
  );
  if (linesError) {
    await supabase.from("estimates").delete().eq("id", id);
    return NextResponse.json({ error: linesError.message }, { status: 400 });
  }

  ensureServerPluginsLoaded();
  await emitHook("estimate:created", {
    estimateId: id,
    estimateNumber: estimate_number,
    customerId: customer_id,
    subtotal: Math.round(lines.reduce((sum, l) => sum + l.quantity * l.unit_price, 0) * 100) / 100,
    orgId: organization_id,
  });
  return NextResponse.json({ success: true, id });
}
