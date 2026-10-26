import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { createClient } from "@/lib/supabase/server";
import { canWrite, getCurrentOrgId, getCurrentUserRole } from "@/lib/org/current";
import { deleteRecurringBill, generateBillNow, toggleRecurringBillActive } from "./actions";
import { bookToday } from "@/lib/org/book-clock";

interface RecurringBillRow {
  id: string;
  frequency: "weekly" | "monthly" | "yearly";
  next_date: string;
  is_active: boolean;
  vendors: { name: string } | null;
}

export default async function RecurringBillsPage() {
  const orgId = await getCurrentOrgId();

  if (!orgId) {
    return (
      <div>
        <PageHeader title="Recurring Bills" description="Generated automatically on their next date, within about an hour (pause a template to stop it). Generate Now does a due one at once." />
        <p className="text-sm text-slate-500">Create an organization first.</p>
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data }, role] = await Promise.all([
    supabase
      .from("recurring_bills")
      .select("id, frequency, next_date, is_active, vendors(name)")
      .eq("organization_id", orgId)
      .order("next_date"),
    getCurrentUserRole(orgId),
  ]);

  const templates = (data as unknown as RecurringBillRow[] | null) ?? [];
  const userCanWrite = canWrite(role);
  const todayDate = await bookToday(orgId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <PageHeader title="Recurring Bills" description="Generated automatically on their next date, within about an hour (pause a template to stop it). Generate Now does a due one at once." />
        {userCanWrite && (
          <Link
            href="/vendors/recurring/new"
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            New Recurring Bill
          </Link>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">Vendor</th>
                <th className="px-5 py-3 font-medium">Frequency</th>
                <th className="px-5 py-3 font-medium">Next Date</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {templates.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-6 text-center text-slate-500">
                    No recurring bills set up yet.
                  </td>
                </tr>
              ) : (
                templates.map((template) => {
                  const isDue = template.is_active && template.next_date <= todayDate;
                  return (
                    <tr key={template.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-5 py-3 text-slate-900">{template.vendors?.name ?? "—"}</td>
                      <td className="px-5 py-3 capitalize text-slate-600">{template.frequency}</td>
                      <td className="px-5 py-3 text-slate-600">
                        {template.next_date}
                        {isDue && (
                          <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                            Due
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-slate-600">
                        {template.is_active ? "Active" : "Paused"}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-3">
                          {userCanWrite && isDue && (
                            <form action={generateBillNow}>
                              <input type="hidden" name="id" value={template.id} />
                              <input type="hidden" name="organizationId" value={orgId} />
                              <button
                                type="submit"
                                className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
                              >
                                Generate Now
                              </button>
                            </form>
                          )}
                          {userCanWrite && (
                            <form action={toggleRecurringBillActive}>
                              <input type="hidden" name="id" value={template.id} />
                              <input
                                type="hidden"
                                name="isActive"
                                value={String(template.is_active)}
                              />
                              <button
                                type="submit"
                                className="text-xs text-slate-500 hover:text-slate-900"
                              >
                                {template.is_active ? "Pause" : "Resume"}
                              </button>
                            </form>
                          )}
                          {userCanWrite && (
                            <form action={deleteRecurringBill}>
                              <input type="hidden" name="id" value={template.id} />
                              <button
                                type="submit"
                                className="text-xs text-slate-400 hover:text-red-600"
                              >
                                Delete
                              </button>
                            </form>
                          )}
                        </div>
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
