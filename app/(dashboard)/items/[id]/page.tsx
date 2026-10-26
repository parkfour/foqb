import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId, getUseAccountCodes } from "@/lib/org/current";
import { formatAccountLabel } from "@/lib/accounts/format";
import { fetchItemSales } from "@/lib/reports/item-sales";
import { formatMoney } from "@/lib/money";
import { getBookCurrency } from "@/lib/org/book-currency";

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  partial: "Partial",
  paid: "Paid",
  void: "Void",
};

interface ItemRow {
  id: string;
  name: string;
  sale_price: number | null;
  accounts: { account_number: string; name: string } | null;
}

export default async function ItemSalesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = await getCurrentOrgId();
  const currency = await getBookCurrency(orgId);
  const formatCurrency = (value: number) => formatMoney(value, currency);

  if (!orgId) {
    redirect("/");
  }

  const supabase = await createClient();
  const [{ data: itemData }, sales, showAccountCodes] = await Promise.all([
    supabase
      .from("items")
      .select("id, name, sale_price, accounts!items_income_account_id_fkey(account_number, name)")
      .eq("id", id)
      .eq("organization_id", orgId)
      .maybeSingle(),
    fetchItemSales(id),
    getUseAccountCodes(orgId),
  ]);

  const item = itemData as unknown as ItemRow | null;
  if (!item) {
    notFound();
  }

  const totalQuantity = sales.reduce((sum, s) => sum + s.quantity, 0);
  const totalRevenue = sales.reduce((sum, s) => sum + s.amount, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          title={item.name}
          description={
            item.accounts
              ? `Posts to ${formatAccountLabel(item.accounts, showAccountCodes)}`
              : "Sales history for this item."
          }
        />
        <Link
          href={`/items/${item.id}/edit`}
          className="text-sm font-medium text-slate-600 underline hover:text-slate-900"
        >
          Edit item
        </Link>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="grid grid-cols-2 gap-px bg-slate-100 sm:grid-cols-3">
          <div className="bg-white px-5 py-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Quantity Sold</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">{totalQuantity}</p>
          </div>
          <div className="bg-white px-5 py-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Total Revenue</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">{formatCurrency(totalRevenue)}</p>
          </div>
          <div className="bg-white px-5 py-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Sale Price</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">
              {item.sale_price != null ? formatCurrency(item.sale_price) : "—"}
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900">Sales</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium">Invoice</th>
                <th className="px-5 py-3 font-medium">Customer</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 text-right font-medium">Qty</th>
                <th className="px-5 py-3 text-right font-medium">Unit Price</th>
                <th className="px-5 py-3 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {sales.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-6 text-center text-slate-500">
                    No sales yet.
                  </td>
                </tr>
              ) : (
                sales.map((sale, i) => (
                  <tr key={`${sale.invoiceId}-${i}`} className="border-b border-slate-100 last:border-0">
                    <td className="px-5 py-3 text-slate-600">{sale.date}</td>
                    <td className="px-5 py-3 text-slate-900">
                      <Link href={`/customers/invoices/${sale.invoiceId}`} className="hover:underline">
                        {sale.invoiceNumber}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-slate-600">{sale.customerName}</td>
                    <td className="px-5 py-3 text-slate-600">{STATUS_LABELS[sale.status]}</td>
                    <td className="px-5 py-3 text-right text-slate-900">{sale.quantity}</td>
                    <td className="px-5 py-3 text-right text-slate-600">{formatCurrency(sale.unitPrice)}</td>
                    <td className="px-5 py-3 text-right font-medium text-slate-900">
                      {formatCurrency(sale.amount)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
