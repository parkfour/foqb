import { PageHeader } from "@/components/ui/page-header";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/org/current";
import { formatTimestamp } from "@/lib/time/book-time";
import { getBookClock } from "@/lib/org/book-clock";

interface AuditLogRow {
  id: string;
  table_name: string;
  row_id: string;
  action: "insert" | "update" | "delete";
  changed_by_email: string | null;
  changed_at: string;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
}

const TABLE_LABELS: Record<string, string> = {
  journal_entries: "Journal Entry",
  invoices: "Invoice",
  invoice_emails: "Invoice Email",
  bills: "Bill",
  invoice_payments: "Customer Payment",
  bill_payments: "Vendor Payment",
  accounts: "Account",
  organizations: "Organization Settings",
  organization_members: "Membership",
};

const ACTION_STYLES: Record<string, string> = {
  insert: "bg-emerald-100 text-emerald-800",
  update: "bg-sky-100 text-sky-800",
  delete: "bg-red-100 text-red-800",
};

export default async function AuditLogPage() {
  const orgId = await getCurrentOrgId();
  const { timeZone } = await getBookClock(orgId);

  if (!orgId) {
    return (
      <div>
        <PageHeader title="Audit Log" description="Who changed what, and when." />
        <p className="text-sm text-slate-500">Create an organization first.</p>
      </div>
    );
  }

  const supabase = await createClient();
  const { data } = await supabase.rpc("get_audit_log", { p_org_id: orgId, p_limit: 200 });
  const entries = (data as AuditLogRow[] | null) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Audit Log" description="Who changed what, and when. Most recent 200 entries." />

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">When</th>
                <th className="px-5 py-3 font-medium">Who</th>
                <th className="px-5 py-3 font-medium">Action</th>
                <th className="px-5 py-3 font-medium">Record</th>
                <th className="px-5 py-3 font-medium">Changes</th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-6 text-center text-slate-500">
                    No activity recorded yet.
                  </td>
                </tr>
              ) : (
                entries.map((entry) => (
                  <tr key={entry.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-5 py-3 whitespace-nowrap text-slate-600">
                      {formatTimestamp(entry.changed_at, timeZone)}
                    </td>
                    <td className="px-5 py-3 text-slate-600">{entry.changed_by_email ?? "—"}</td>
                    <td className="px-5 py-3">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${ACTION_STYLES[entry.action]}`}
                      >
                        {entry.action}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-900">
                      {TABLE_LABELS[entry.table_name] ?? entry.table_name}
                    </td>
                    <td className="px-5 py-3">
                      <details>
                        <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-900">
                          View
                        </summary>
                        <pre className="mt-2 max-w-md overflow-x-auto whitespace-pre-wrap rounded-md bg-slate-50 p-2 text-xs text-slate-700">
                          {JSON.stringify(entry.new_data ?? entry.old_data, null, 2)}
                        </pre>
                      </details>
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
