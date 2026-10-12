import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { CsvImportForm } from "@/components/csv/import-form";
import { createClient } from "@/lib/supabase/server";
import { canWrite, getCurrentOrgId, getCurrentUserRole } from "@/lib/org/current";
import { toggleCustomerActive, deleteCustomer } from "./actions";

interface CustomerRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  is_active: boolean;
}

export default async function CustomersPage() {
  const orgId = await getCurrentOrgId();

  if (!orgId) {
    return (
      <div>
        <PageHeader title="Customers" description="Manage customers and their invoices." />
        <p className="text-sm text-slate-500">Create an organization first.</p>
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data }, role] = await Promise.all([
    supabase
      .from("customers")
      .select("id, name, email, phone, is_active")
      .eq("organization_id", orgId)
      .order("name"),
    getCurrentUserRole(orgId),
  ]);

  const customers = (data as CustomerRow[] | null) ?? [];
  const userCanWrite = canWrite(role);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader title="Customers" description="Manage customers and their invoices." />
        <div className="flex flex-wrap items-center gap-3">
          {userCanWrite && <CsvImportForm action="/api/import/customers" label="Import CSV" />}
          {userCanWrite && (
            <Link
              href="/customers/new"
              className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Add Customer
            </Link>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Email</th>
                <th className="px-5 py-3 font-medium">Phone</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {customers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-6 text-center text-slate-500">
                    No customers yet.
                  </td>
                </tr>
              ) : (
                customers.map((customer) => (
                  <tr key={customer.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-5 py-3 text-slate-900">
                      <Link href={`/customers/${customer.id}`} className="hover:underline">
                        {customer.name}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-slate-600">{customer.email ?? "—"}</td>
                    <td className="px-5 py-3 text-slate-600">{customer.phone ?? "—"}</td>
                    <td className="px-5 py-3">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                          customer.is_active
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {customer.is_active ? "active" : "inactive"}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      {userCanWrite && (
                        <div className="flex items-center justify-end gap-3">
                          <Link
                            href={`/customers/${customer.id}/edit`}
                            className="text-sm text-slate-400 hover:text-slate-900"
                          >
                            Edit
                          </Link>
                          <form action={toggleCustomerActive}>
                            <input type="hidden" name="id" value={customer.id} />
                            <input
                              type="hidden"
                              name="isActive"
                              value={customer.is_active ? "true" : "false"}
                            />
                            <button
                              type="submit"
                              className="text-sm text-slate-400 hover:text-slate-900"
                            >
                              {customer.is_active ? "Disable" : "Enable"}
                            </button>
                          </form>
                          <form action={deleteCustomer}>
                            <input type="hidden" name="id" value={customer.id} />
                            <button
                              type="submit"
                              className="text-sm text-slate-400 hover:text-red-600"
                            >
                              Delete
                            </button>
                          </form>
                        </div>
                      )}
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
