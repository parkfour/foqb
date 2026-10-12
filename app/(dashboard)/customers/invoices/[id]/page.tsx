import { notFound, redirect } from "next/navigation";
import { InvoiceDetail } from "@/components/customers/invoice-detail";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/org/current";

interface RawInvoice {
  id: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string | null;
  status: "open" | "partial" | "paid" | "void";
  tax_rate: number;
  tax_amount: number;
  customers: { name: string; email: string | null; billing_address: string | null } | null;
  invoice_lines: {
    description: string | null;
    quantity: number;
    unit_price: number;
    amount: number;
  }[];
  invoice_payments: { amount: number }[];
}

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const orgId = await getCurrentOrgId();

  if (!orgId) {
    redirect("/");
  }

  const supabase = await createClient();

  const [{ data: invoice }, { data: org }] = await Promise.all([
    supabase
      .from("invoices")
      .select(
        "id, invoice_number, invoice_date, due_date, status, tax_rate, tax_amount, customers(name, email, billing_address), invoice_lines(description, quantity, unit_price, amount), invoice_payments(amount)",
      )
      .eq("id", id)
      .eq("organization_id", orgId)
      .maybeSingle(),
    supabase.from("organizations").select("name, logo_data_url").eq("id", orgId).maybeSingle(),
  ]);

  if (!invoice) {
    notFound();
  }

  const typedInvoice = invoice as unknown as RawInvoice;
  const subtotal = typedInvoice.invoice_lines.reduce((sum, l) => sum + Number(l.amount), 0);
  const taxAmount = Number(typedInvoice.tax_amount);
  const total = subtotal + taxAmount;
  const paid = typedInvoice.invoice_payments.reduce((sum, p) => sum + Number(p.amount), 0);

  return (
    <InvoiceDetail
      organizationName={org?.name ?? "Your Organization"}
      organizationLogoDataUrl={org?.logo_data_url ?? null}
      invoiceNumber={typedInvoice.invoice_number}
      invoiceDate={typedInvoice.invoice_date}
      dueDate={typedInvoice.due_date}
      status={typedInvoice.status}
      customer={typedInvoice.customers}
      lines={typedInvoice.invoice_lines}
      subtotal={subtotal}
      taxRate={Number(typedInvoice.tax_rate)}
      taxAmount={taxAmount}
      total={total}
      remaining={Math.round((total - paid) * 100) / 100}
    />
  );
}
