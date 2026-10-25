import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { emitHook } from "@/lib/plugins/hooks";
import { ensureServerPluginsLoaded } from "@/lib/plugins/server-loader";
import { findAccountsReceivableAccount, findSalesTaxPayableAccount } from "@/lib/org/control-accounts";
import { applyTaxes, type AppliedTax } from "@/lib/sales-tax";

interface InvoiceLineInput {
  item_id: string | null;
  account_id: string;
  description: string;
  quantity: number;
  unit_price: number;
}

interface InvoiceRequestBody {
  organization_id: string;
  customer_id: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string | null;
  tax_rate: number;
  // Named rates (Settings → Sales tax) to apply; when given, tax_rate is
  // ignored and worked out from them.
  tax_rate_ids?: string[];
  lines: InvoiceLineInput[];
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Partial<InvoiceRequestBody>;
  const { organization_id, customer_id, invoice_number, invoice_date, due_date, lines } = body;
  let taxRate = Number(body.tax_rate) || 0;
  const taxRateIds = Array.isArray(body.tax_rate_ids) ? [...new Set(body.tax_rate_ids)] : [];

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

  const computedLines = lines.map((line) => ({
    item_id: line.item_id ?? null,
    account_id: line.account_id,
    description: line.description ?? "",
    quantity: line.quantity,
    unit_price: line.unit_price,
    amount: Math.round(line.quantity * line.unit_price * 100) / 100,
  }));

  if (computedLines.some((l) => !l.account_id || l.amount <= 0)) {
    return NextResponse.json(
      { error: "Every line needs an account and a positive amount" },
      { status: 400 },
    );
  }

  const subtotal = computedLines.reduce((sum, l) => sum + l.amount, 0);
  let taxAmount = Math.round(subtotal * (taxRate / 100) * 100) / 100;
  let applied: AppliedTax[] = [];
  if (taxRateIds.length > 0) {
    const { data: rates } = await supabase
      .from("sales_tax_rates")
      .select("id, name, rate, account_id")
      .eq("organization_id", organization_id)
      .eq("is_active", true)
      .in("id", taxRateIds);
    if ((rates ?? []).length !== taxRateIds.length) {
      return NextResponse.json({ error: "One of the sales tax rates isn't in use any more" }, { status: 400 });
    }
    const result = applyTaxes(subtotal, rates ?? []);
    applied = result.taxes;
    taxRate = result.totalRate;
    taxAmount = result.totalTax;
  }
  const total = Math.round((subtotal + taxAmount) * 100) / 100;

  const arAccount = await findAccountsReceivableAccount(supabase, organization_id);
  if ("error" in arAccount) {
    return NextResponse.json({ error: arAccount.error }, { status: 400 });
  }

  // Each tax's credit goes to its rate's own account, or else the book's
  // Sales Tax Payable; a single typed-in rate always goes to the latter.
  let taxAccountId: string | null = null;
  if (taxAmount > 0 && (applied.length === 0 || applied.some((t) => !t.account_id))) {
    const taxAccount = await findSalesTaxPayableAccount(supabase, organization_id);
    if ("error" in taxAccount) {
      return NextResponse.json({ error: taxAccount.error }, { status: 400 });
    }
    taxAccountId = taxAccount.id;
  }
  const taxCredits =
    applied.length > 0
      ? applied.filter((t) => t.amount > 0).map((t) => ({ account_id: (t.account_id ?? taxAccountId) as string, amount: t.amount }))
      : taxAmount > 0
        ? [{ account_id: taxAccountId as string, amount: taxAmount }]
        : [];

  const entryId = randomUUID();

  const { error: entryError } = await supabase.from("journal_entries").insert({
    id: entryId,
    organization_id,
    entry_date: invoice_date,
    memo: `Invoice ${invoice_number}`,
    status: "draft",
    created_by: user.id,
  });

  if (entryError) {
    return NextResponse.json({ error: entryError.message }, { status: 500 });
  }

  const { error: linesError } = await supabase.from("journal_lines").insert([
    { journal_entry_id: entryId, account_id: arAccount.id, debit: total, credit: 0 },
    ...computedLines.map((l) => ({
      journal_entry_id: entryId,
      account_id: l.account_id,
      debit: 0,
      credit: l.amount,
    })),
    ...taxCredits.map((t) => ({ journal_entry_id: entryId, account_id: t.account_id, debit: 0, credit: t.amount })),
  ]);

  if (linesError) {
    await supabase.from("journal_entries").delete().eq("id", entryId);
    return NextResponse.json({ error: linesError.message }, { status: 500 });
  }

  const { error: postError } = await supabase
    .from("journal_entries")
    .update({ status: "posted" })
    .eq("id", entryId);

  if (postError) {
    await supabase.from("journal_entries").delete().eq("id", entryId);
    return NextResponse.json({ error: postError.message }, { status: 500 });
  }

  const invoiceId = randomUUID();

  const { error: invoiceError } = await supabase.from("invoices").insert({
    id: invoiceId,
    organization_id,
    customer_id,
    invoice_number,
    invoice_date,
    due_date: due_date || null,
    status: "open",
    tax_rate: taxRate,
    tax_amount: taxAmount,
    journal_entry_id: entryId,
  });

  if (invoiceError) {
    await supabase.from("journal_entries").delete().eq("id", entryId);
    return NextResponse.json({ error: invoiceError.message }, { status: 500 });
  }

  const { error: invoiceLinesError } = await supabase.from("invoice_lines").insert(
    computedLines.map((l) => ({
      invoice_id: invoiceId,
      item_id: l.item_id,
      description: l.description,
      account_id: l.account_id,
      quantity: l.quantity,
      unit_price: l.unit_price,
      amount: l.amount,
    })),
  );

  if (invoiceLinesError) {
    await supabase.from("invoices").delete().eq("id", invoiceId);
    await supabase.from("journal_entries").delete().eq("id", entryId);
    return NextResponse.json({ error: invoiceLinesError.message }, { status: 500 });
  }

  if (applied.length > 0) {
    const { error: taxesError } = await supabase.from("invoice_taxes").insert(
      applied.map((t) => ({
        organization_id,
        invoice_id: invoiceId,
        tax_rate_id: t.tax_rate_id,
        name: t.name,
        rate: t.rate,
        amount: t.amount,
        account_id: t.account_id ?? taxAccountId,
      })),
    );
    if (taxesError) {
      await supabase.from("invoices").delete().eq("id", invoiceId);
      await supabase.from("journal_entries").delete().eq("id", entryId);
      return NextResponse.json({ error: taxesError.message }, { status: 500 });
    }
  }

  ensureServerPluginsLoaded();
  await emitHook("invoice:created", {
    invoiceId,
    invoiceNumber: invoice_number,
    customerId: customer_id ?? null,
    total,
    orgId: organization_id,
  });

  return NextResponse.json({ success: true, id: invoiceId });
}
