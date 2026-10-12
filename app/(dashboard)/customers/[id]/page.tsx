import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/org/current";
import { AGING_BUCKETS, fetchCustomerInvoices } from "@/lib/reports/aging";

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

interface CustomerRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  billing_address: string | null;
  is_active: boolean;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function CustomerStatusPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = await getCurrentOrgId();

  if (!orgId) {
    redirect("/");
  }

  const supabase = await createClient();
  const [{ data: customerData }, invoices] = await Promise.all([
    supabase
      .from("customers")
      .select("id, name, email, phone, billing_address, is_active")
      .eq("id", id)
      .eq("organization_id", orgId)
      .maybeSingle(),
    fetchCustomerInvoices(orgId, id, today()),
  ]);

  const customer = customerData as CustomerRow | null;
  if (!customer) {
    notFound();
  }

  const currentBalance = invoices.reduce((sum, inv) => sum + inv.remaining, 0);
  const outstanding = invoices.filter((inv) => inv.remaining > 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          title={customer.name}
          description={
            [customer.email, customer.phone].filter(Boolean).join(" · ") ||
            "Invoice history and current balance."
          }
        />
        <Link
          href={`/customers/${customer.id}/edit`}
          className="text-sm font-medium text-slate-600 underline hover:text-slate-900"
        >
          Edit customer
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
                  outstanding.filter((inv) => inv.bucket === bucket).reduce((s, inv) => s + inv.remaining, 0),
                )}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900">Invoices</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium">Invoice</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 text-right font-medium">Total</th>
                <th className="px-5 py-3 text-right font-medium">Paid</th>
                <th className="px-5 py-3 text-right font-medium">Remaining</th>
              </tr>
            </thead>
            <tbody>
              {invoices.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-6 text-center text-slate-500">
                    No invoices yet.
                  </td>
                </tr>
              ) : (
                invoices.map((inv) => (
                  <tr key={inv.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-5 py-3 text-slate-600">{inv.date}</td>
                    <td className="px-5 py-3 text-slate-900">
                      <Link href={`/customers/invoices/${inv.id}`} className="hover:underline">
                        {inv.number}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-slate-600">{STATUS_LABELS[inv.status]}</td>
                    <td className="px-5 py-3 text-right text-slate-900">{formatCurrency(inv.total)}</td>
                    <td className="px-5 py-3 text-right text-slate-600">{formatCurrency(inv.paid)}</td>
                    <td className="px-5 py-3 text-right font-medium text-slate-900">
                      {formatCurrency(inv.remaining)}
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
