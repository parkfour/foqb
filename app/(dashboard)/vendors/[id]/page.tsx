import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/org/current";
import { AGING_BUCKETS, fetchVendorBills } from "@/lib/reports/aging";

const BUCKET_LABELS: Record<string, string> = {
  current: "Current",
  "1-30": "1–30 days",
  "31-60": "31–60 days",
  "61-90": "61–90 days",
  "90+": "90+ days",
};

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  partial: "Partial",
  paid: "Paid",
  void: "Void",
};

interface VendorRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  is_active: boolean;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function VendorStatusPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = await getCurrentOrgId();

  if (!orgId) {
    redirect("/");
  }

  const supabase = await createClient();
  const [{ data: vendorData }, bills] = await Promise.all([
    supabase
      .from("vendors")
      .select("id, name, email, phone, is_active")
      .eq("id", id)
      .eq("organization_id", orgId)
      .maybeSingle(),
    fetchVendorBills(orgId, id, today()),
  ]);

  const vendor = vendorData as VendorRow | null;
  if (!vendor) {
    notFound();
  }

  const currentBalance = bills.reduce((sum, bill) => sum + bill.remaining, 0);
  const outstanding = bills.filter((bill) => bill.remaining > 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          title={vendor.name}
          description={
            [vendor.email, vendor.phone].filter(Boolean).join(" · ") ||
            "Bill history and current balance."
          }
        />
        <Link
          href={`/vendors/${vendor.id}/edit`}
          className="text-sm font-medium text-slate-600 underline hover:text-slate-900"
        >
          Edit vendor
        </Link>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900">Current Balance</h2>
          <p className="text-lg font-semibold text-slate-900">{formatCurrency(currentBalance)}</p>
        </div>
        <div className="grid grid-cols-2 gap-px bg-slate-100 sm:grid-cols-5">
          {AGING_BUCKETS.map((bucket) => (
            <div key={bucket} className="bg-white px-5 py-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">{BUCKET_LABELS[bucket]}</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">
                {formatCurrency(
                  outstanding.filter((bill) => bill.bucket === bucket).reduce((s, bill) => s + bill.remaining, 0),
                )}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900">Bills</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium">Bill</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 text-right font-medium">Total</th>
                <th className="px-5 py-3 text-right font-medium">Paid</th>
                <th className="px-5 py-3 text-right font-medium">Remaining</th>
              </tr>
            </thead>
            <tbody>
              {bills.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-6 text-center text-slate-500">
                    No bills yet.
                  </td>
                </tr>
              ) : (
                bills.map((bill) => (
                  <tr key={bill.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-5 py-3 text-slate-600">{bill.date}</td>
                    <td className="px-5 py-3 text-slate-900">{bill.number}</td>
                    <td className="px-5 py-3 text-slate-600">{STATUS_LABELS[bill.status]}</td>
                    <td className="px-5 py-3 text-right text-slate-900">{formatCurrency(bill.total)}</td>
                    <td className="px-5 py-3 text-right text-slate-600">{formatCurrency(bill.paid)}</td>
                    <td className="px-5 py-3 text-right font-medium text-slate-900">
                      {formatCurrency(bill.remaining)}
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
