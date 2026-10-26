import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { ConvertEstimateForm } from "@/components/customers/convert-estimate-form";
import { createClient } from "@/lib/supabase/server";
import { canWrite, getCurrentOrgId, getCurrentUserRole } from "@/lib/org/current";
import { bookToday } from "@/lib/org/book-clock";
import { formatMoney } from "@/lib/money";
import { getBookCurrency } from "@/lib/org/book-currency";
import { applyTaxes, type SalesTaxRate } from "@/lib/sales-tax";
import { ESTIMATE_STATUS_STYLES, estimateSubtotal } from "@/lib/ar/estimates";
import { setEstimateStatus } from "../actions";
import { PluginSlot } from "@/components/plugins/plugin-slot";

interface RawEstimate {
  id: string;
  estimate_number: string;
  estimate_date: string;
  expiry_date: string | null;
  status: "open" | "accepted" | "declined" | "invoiced";
  tax_rate: number;
  tax_rate_ids: string[];
  invoice_id: string | null;
  customers: { name: string; email: string | null } | null;
  estimate_lines: { id: string; description: string | null; quantity: number; unit_price: number }[];
}

export default async function EstimateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = await getCurrentOrgId();
  if (!orgId) redirect("/");

  const supabase = await createClient();
  const [{ data }, role, today, currency] = await Promise.all([
    supabase
      .from("estimates")
      .select(
        "id, estimate_number, estimate_date, expiry_date, status, tax_rate, tax_rate_ids, invoice_id, customers(name, email), estimate_lines(id, description, quantity, unit_price)",
      )
      .eq("id", id)
      .eq("organization_id", orgId)
      .maybeSingle(),
    getCurrentUserRole(orgId),
    bookToday(orgId),
    getBookCurrency(orgId),
  ]);
  if (!data) notFound();
  const e = data as unknown as RawEstimate;
  const formatCurrency = (value: number) => formatMoney(value, currency);

  const subtotal = estimateSubtotal(e.estimate_lines);
  let taxes: { name: string; amount: number }[] = [];
  if (e.tax_rate_ids.length > 0) {
    const { data: rates } = await supabase
      .from("sales_tax_rates")
      .select("id, name, rate, account_id")
      .eq("organization_id", orgId)
      .in("id", e.tax_rate_ids);
    taxes = applyTaxes(subtotal, (rates ?? []) as SalesTaxRate[]).taxes;
  } else if (Number(e.tax_rate) > 0) {
    taxes = [{ name: `Tax (${Number(e.tax_rate)}%)`, amount: Math.round(subtotal * (Number(e.tax_rate) / 100) * 100) / 100 }];
  }
  const total = subtotal + taxes.reduce((s, t) => s + t.amount, 0);
  const userCanWrite = canWrite(role);
  const expired = e.status !== "invoiced" && e.expiry_date !== null && e.expiry_date < today;

  const statusButton = (status: "open" | "accepted" | "declined", label: string) => (
    <form action={setEstimateStatus}>
      <input type="hidden" name="id" value={e.id} />
      <input type="hidden" name="status" value={status} />
      <button type="submit" className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
        {label}
      </button>
    </form>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <PageHeader title={`Estimate ${e.estimate_number}`} description={e.customers?.name ?? ""} />
        <Link href="/customers/estimates" className="text-sm font-medium text-slate-600 underline hover:text-slate-900">
          ← All estimates
        </Link>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600">
          <span>Dated {e.estimate_date}</span>
          {e.expiry_date && (
            <span className={expired ? "text-rose-600" : ""}>
              {expired ? "Expired" : "Expires"} {e.expiry_date}
            </span>
          )}
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${ESTIMATE_STATUS_STYLES[e.status]}`}>{e.status}</span>
          {e.invoice_id && (
            <Link href={`/customers/invoices/${e.invoice_id}`} className="underline hover:text-slate-900">
              View the invoice
            </Link>
          )}
          <PluginSlot
            name="estimate.actions"
            context={{
              estimateId: e.id,
              estimateNumber: e.estimate_number,
              customer: e.customers ? { name: e.customers.name, email: e.customers.email ?? null } : null,
              subtotal,
              status: e.status,
            }}
          />
        </div>

        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="py-2 font-medium">Description</th>
              <th className="py-2 text-right font-medium">Qty</th>
              <th className="py-2 text-right font-medium">Unit price</th>
              <th className="py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {e.estimate_lines.map((l) => (
              <tr key={l.id} className="border-b border-slate-100">
                <td className="py-2 text-slate-900">{l.description || "—"}</td>
                <td className="py-2 text-right text-slate-600">{Number(l.quantity)}</td>
                <td className="py-2 text-right text-slate-600">{formatCurrency(Number(l.unit_price))}</td>
                <td className="py-2 text-right text-slate-900">{formatCurrency(estimateSubtotal([l]))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="text-right">
            <tr>
              <td colSpan={3} className="pt-3 text-slate-600">
                Subtotal
              </td>
              <td className="pt-3 text-slate-900">{formatCurrency(subtotal)}</td>
            </tr>
            {taxes.map((t) => (
              <tr key={t.name}>
                <td colSpan={3} className="text-slate-600">
                  {t.name}
                </td>
                <td className="text-slate-900">{formatCurrency(t.amount)}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td colSpan={3} className="pt-1">
                Total
              </td>
              <td className="pt-1">{formatCurrency(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {userCanWrite && e.status !== "invoiced" && (
        <div className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap gap-2">
            {e.status !== "accepted" && statusButton("accepted", "Mark accepted")}
            {e.status !== "declined" && statusButton("declined", "Mark declined")}
            {e.status !== "open" && statusButton("open", "Reopen")}
          </div>
          <ConvertEstimateForm id={e.id} defaultNumber={e.estimate_number} today={today} />
        </div>
      )}
    </div>
  );
}
