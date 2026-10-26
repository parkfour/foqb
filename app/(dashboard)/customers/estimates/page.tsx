import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { createClient } from "@/lib/supabase/server";
import { canWrite, getCurrentOrgId, getCurrentUserRole } from "@/lib/org/current";
import { formatMoney } from "@/lib/money";
import { getBookCurrency } from "@/lib/org/book-currency";
import { ESTIMATE_STATUS_STYLES, estimateSubtotal } from "@/lib/ar/estimates";

interface RawEstimate {
  id: string;
  estimate_number: string;
  estimate_date: string;
  expiry_date: string | null;
  status: "open" | "accepted" | "declined" | "invoiced";
  customers: { name: string } | null;
  estimate_lines: { quantity: number; unit_price: number }[];
}


export default async function EstimatesListPage() {
  const orgId = await getCurrentOrgId();
  const currency = await getBookCurrency(orgId);
  const formatCurrency = (value: number) => formatMoney(value, currency);
  const description = "Quotes for customers. Nothing is booked until one becomes an invoice.";

  if (!orgId) {
    return (
      <div>
        <PageHeader title="Estimates" description={description} />
        <p className="text-sm text-slate-500">Create an organization first.</p>
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data }, role] = await Promise.all([
    supabase
      .from("estimates")
      .select("id, estimate_number, estimate_date, expiry_date, status, customers(name), estimate_lines(quantity, unit_price)")
      .eq("organization_id", orgId)
      .order("estimate_date", { ascending: false }),
    getCurrentUserRole(orgId),
  ]);
  const estimates = (data as unknown as RawEstimate[] | null) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <PageHeader title="Estimates" description={description} />
        {canWrite(role) && (
          <Link
            href="/customers/estimates/new"
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            New Estimate
          </Link>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">Number</th>
                <th className="px-5 py-3 font-medium">Customer</th>
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium">Expires</th>
                <th className="px-5 py-3 font-medium">Before tax</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {estimates.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-6 text-center text-slate-500">
                    No estimates yet.
                  </td>
                </tr>
              ) : (
                estimates.map((e) => (
                  <tr key={e.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-5 py-3 text-slate-900">
                      <Link href={`/customers/estimates/${e.id}`} className="hover:underline">
                        {e.estimate_number}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-slate-600">{e.customers?.name ?? "—"}</td>
                    <td className="px-5 py-3 text-slate-600">{e.estimate_date}</td>
                    <td className="px-5 py-3 text-slate-600">{e.expiry_date ?? "—"}</td>
                    <td className="px-5 py-3 text-slate-600">{formatCurrency(estimateSubtotal(e.estimate_lines))}</td>
                    <td className="px-5 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${ESTIMATE_STATUS_STYLES[e.status]}`}>
                        {e.status}
                      </span>
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
