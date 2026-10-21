import { createClient } from "@/lib/supabase/server";

export interface ItemSaleRow {
  invoiceId: string;
  invoiceNumber: string;
  date: string;
  customerName: string;
  status: "open" | "partial" | "paid" | "void";
  quantity: number;
  unitPrice: number;
  amount: number;
}

interface RawItemSaleLine {
  quantity: number;
  unit_price: number;
  amount: number;
  invoices: {
    id: string;
    invoice_number: string;
    invoice_date: string;
    status: "open" | "partial" | "paid" | "void";
    customers: { name: string } | null;
  } | null;
}

// RLS on invoice_lines/invoices already scopes this to the caller's own
// orgs; the caller is also expected to have already verified itemId
// belongs to orgId (see the [id] page's own item lookup) before calling.
export async function fetchItemSales(itemId: string): Promise<ItemSaleRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoice_lines")
    .select(
      "quantity, unit_price, amount, invoices(id, invoice_number, invoice_date, status, customers(name))",
    )
    .eq("item_id", itemId);

  if (error) throw error;

  return ((data as unknown as RawItemSaleLine[]) ?? [])
    .filter((line) => line.invoices && line.invoices.status !== "void")
    .map((line) => ({
      invoiceId: line.invoices!.id,
      invoiceNumber: line.invoices!.invoice_number,
      date: line.invoices!.invoice_date,
      customerName: line.invoices!.customers?.name ?? "—",
      status: line.invoices!.status,
      quantity: Number(line.quantity),
      unitPrice: Number(line.unit_price),
      amount: Number(line.amount),
    }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}
