import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { createClient } from "@/lib/supabase/server";
import { canWrite, getCurrentOrgId, getCurrentUserRole } from "@/lib/org/current";
import { voidBill } from "../actions";

interface RawBill {
  id: string;
  bill_number: string;
  bill_date: string;
  status: "open" | "partial" | "paid" | "void";
  vendors: { name: string } | null;
  bill_lines: { amount: number }[];
  bill_payments: { amount: number }[];
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

const STATUS_STYLES: Record<string, string> = {
  open: "bg-amber-100 text-amber-800",
  partial: "bg-sky-100 text-sky-800",
  paid: "bg-emerald-100 text-emerald-800",
  void: "bg-slate-100 text-slate-600",
};

export default async function BillsListPage() {
  const orgId = await getCurrentOrgId();

  if (!orgId) {
    return (
      <div>
        <PageHeader title="Bills" description="All vendor bills and their status." />
        <p className="text-sm text-slate-500">Create an organization first.</p>
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data }, role] = await Promise.all([
    supabase
      .from("bills")
      .select(
        "id, bill_number, bill_date, status, vendors(name), bill_lines(amount), bill_payments(amount)",
      )
      .eq("organization_id", orgId)
      .order("bill_date", { ascending: false }),
    getCurrentUserRole(orgId),
  ]);

  const bills = (data as unknown as RawBill[] | null) ?? [];
  const userCanWrite = canWrite(role);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <PageHeader title="Bills" description="All vendor bills and their status." />
        {userCanWrite && (
          <Link
            href="/vendors/bills/new"
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Enter Bill
          </Link>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">Number</th>
                <th className="px-5 py-3 font-medium">Vendor</th>
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium">Total</th>
                <th className="px-5 py-3 font-medium">Remaining</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {bills.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-6 text-center text-slate-500">
                    No bills yet.
                  </td>
                </tr>
              ) : (
                bills.map((bill) => {
                  const total = bill.bill_lines.reduce((sum, l) => sum + Number(l.amount), 0);
                  const paid = bill.bill_payments.reduce((sum, p) => sum + Number(p.amount), 0);
                  const remaining = Math.round((total - paid) * 100) / 100;

                  return (
                    <tr key={bill.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-5 py-3 text-slate-900">{bill.bill_number}</td>
                      <td className="px-5 py-3 text-slate-600">{bill.vendors?.name ?? "—"}</td>
                      <td className="px-5 py-3 text-slate-600">{bill.bill_date}</td>
                      <td className="px-5 py-3 text-slate-600">{formatCurrency(total)}</td>
                      <td className="px-5 py-3 text-slate-600">
                        {bill.status === "void" ? "—" : formatCurrency(remaining)}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[bill.status]}`}
                        >
                          {bill.status}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        {userCanWrite && bill.status === "open" && (
                          <form action={voidBill}>
                            <input type="hidden" name="id" value={bill.id} />
                            <button
                              type="submit"
                              className="text-sm text-slate-400 hover:text-red-600"
                            >
                              Void
                            </button>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
