import { PageHeader } from "@/components/ui/page-header";
import { createClient } from "@/lib/supabase/server";
import { suspendOrganization, unsuspendOrganization, updateSiteSettings } from "./actions";
import { getSiteSettings } from "@/lib/site/settings";
import { DeleteOrganizationDialog } from "@/components/site-admin/delete-organization-dialog";
import { DemoteSiteAdminButton } from "@/components/site-admin/demote-site-admin-button";
import { CreateSiteAdminForm } from "@/components/site-admin/create-site-admin-form";

interface OrganizationRow {
  id: string;
  name: string;
  status: "active" | "suspended";
  created_at: string;
  member_count: number;
}

interface SiteAdminRow {
  user_id: string;
  email: string;
  created_at: string;
  has_logged_in: boolean;
}

interface ActionRow {
  id: string;
  action: "suspend" | "unsuspend" | "delete" | "promote" | "demote" | "signups_on" | "signups_off" | "banks_on" | "banks_off";
  organization_name: string | null;
  site_admin_email: string | null;
  target_email: string | null;
  created_at: string;
}

const ACTION_LABELS: Record<ActionRow["action"], string> = {
  suspend: "suspended",
  unsuspend: "unsuspended",
  delete: "deleted",
  promote: "promoted",
  demote: "demoted",
  signups_on: "turned on sign-ups",
  signups_off: "turned off sign-ups",
  banks_on: "turned on connecting banks",
  banks_off: "turned off connecting banks",
};

const SETTING_ACTIONS: ReadonlySet<ActionRow["action"]> = new Set([
  "signups_on",
  "signups_off",
  "banks_on",
  "banks_off",
]);

export default async function SiteAdminPage() {
  const supabase = await createClient();

  const [{ data: orgData }, { data: adminData }, { data: actionData }, siteSettings] = await Promise.all([
    supabase.rpc("get_all_organizations"),
    supabase.rpc("get_site_admins"),
    supabase.rpc("get_site_admin_actions"),
    getSiteSettings(supabase),
  ]);

  const organizations = (orgData as OrganizationRow[] | null) ?? [];
  const siteAdmins = (adminData as SiteAdminRow[] | null) ?? [];
  const actions = (actionData as ActionRow[] | null) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Site Admin"
        description="Access control across every organization on this instance — suspend, delete, and manage who else can do this. No visibility into any organization's financial data."
      />

      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Site Settings</h2>
        <form action={updateSiteSettings} className="mt-3 flex flex-col gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              name="signupsEnabled"
              defaultChecked={siteSettings.signupsEnabled}
              className="h-4 w-4 rounded border-slate-300"
            />
            Allow sign-ups
          </label>
          <p className="-mt-2 pl-6 text-xs text-slate-500">
            When off, nobody can create their own account. Site Admins and organization owners can
            still create accounts for people.
          </p>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              name="bankLinkingEnabled"
              defaultChecked={siteSettings.bankLinkingEnabled}
              className="h-4 w-4 rounded border-slate-300"
            />
            Allow connecting banks
          </label>
          <p className="-mt-2 pl-6 text-xs text-slate-500">
            When off, no organization can connect or reconnect a bank. Existing connections keep
            syncing until disconnected. Each organization&rsquo;s owners can also turn it off for
            their own organization.
          </p>
          <button
            type="submit"
            className="w-fit rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
          >
            Save
          </button>
        </form>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Organizations</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-5 py-3 font-medium">Name</th>
              <th className="px-5 py-3 font-medium">Members</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium">Created</th>
              <th className="px-5 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {organizations.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-6 text-center text-slate-500">
                  No organizations yet.
                </td>
              </tr>
            ) : (
              organizations.map((org) => (
                <tr key={org.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-5 py-3 text-slate-900">{org.name}</td>
                  <td className="px-5 py-3 text-slate-600">{org.member_count}</td>
                  <td className="px-5 py-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        org.status === "active"
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {org.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-slate-600">
                    {new Date(org.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <form action={org.status === "active" ? suspendOrganization : unsuspendOrganization}>
                        <input type="hidden" name="id" value={org.id} />
                        <button
                          type="submit"
                          className="text-xs text-slate-500 hover:text-slate-900"
                        >
                          {org.status === "active" ? "Suspend" : "Unsuspend"}
                        </button>
                      </form>
                      <DeleteOrganizationDialog organizationId={org.id} organizationName={org.name} />
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Site Admins</h2>
        <ul className="mt-3 flex flex-col gap-2">
          {siteAdmins.map((admin) => (
            <li
              key={admin.user_id}
              className="flex items-center justify-between rounded-md border border-slate-100 px-3 py-2"
            >
              <div>
                <p className="text-sm text-slate-900">{admin.email}</p>
                {!admin.has_logged_in && (
                  <span className="text-xs text-amber-700">not yet logged in</span>
                )}
              </div>
              <DemoteSiteAdminButton userId={admin.user_id} />
            </li>
          ))}
        </ul>
        <CreateSiteAdminForm />
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Recent Actions</h2>
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {actions.length === 0 ? (
            <li className="text-slate-500">No actions yet.</li>
          ) : (
            actions.map((a) => (
              <li key={a.id} className="border-b border-slate-100 pb-2 last:border-0">
                <span className="text-slate-900">{a.site_admin_email ?? "someone"}</span>{" "}
                {ACTION_LABELS[a.action]}{" "}
                {SETTING_ACTIONS.has(a.action) ? null : a.action === "promote" || a.action === "demote" ? (
                  <span className="font-medium text-slate-900">{a.target_email}</span>
                ) : (
                  <span className="font-medium text-slate-900">
                    {a.organization_name ?? "an organization"}
                  </span>
                )}
                <span className="text-slate-400"> — {new Date(a.created_at).toLocaleString()}</span>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
