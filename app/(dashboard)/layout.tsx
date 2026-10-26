import type { ReactNode } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { DownloadButton } from "@/components/ui/download-button";
import { createClient } from "@/lib/supabase/server";
import { canWrite, getCurrentOrgId, getCurrentUserRole, getOrgStatus, getUserOrganizations } from "@/lib/org/current";
import { isSiteAdmin } from "@/lib/org/site-admin";
import { requireCurrentPolicyAcceptance } from "@/lib/legal/policy";
import { getSourceCodeUrl } from "@/lib/legal/source-code";
import { getBookClock } from "@/lib/org/book-clock";
import { BookClockProvider } from "@/components/providers/book-clock-provider";
import { BookCurrencyProvider } from "@/components/providers/book-currency-provider";
import { getBookCurrency } from "@/lib/org/book-currency";
import { EnabledPluginsProvider } from "@/components/plugins/plugin-slot";
import { ungatedPluginIds } from "@/lib/plugins/acknowledgements";
import { getOrgEnabledPluginIds } from "@/lib/plugins/settings";
import { pluginPageLinks } from "@/lib/plugins/pages";
import { UncategorizedToast } from "@/components/layout/uncategorized-toast";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  await requireCurrentPolicyAcceptance();

  const [currentOrgId, organizations, siteAdmin] = await Promise.all([
    getCurrentOrgId(),
    getUserOrganizations(),
    isSiteAdmin(),
  ]);
  const [role, orgStatus, bookClock, currency] = await Promise.all([
    getCurrentUserRole(currentOrgId),
    getOrgStatus(currentOrgId),
    getBookClock(currentOrgId),
    getBookCurrency(currentOrgId),
  ]);

  let inventoryEnabled = false;
  let orgPluginIds = ungatedPluginIds();
  if (currentOrgId) {
    const supabase = await createClient();
    const [orgData, pluginIds] = await Promise.all([
      supabase.from("organizations").select("inventory_enabled").eq("id", currentOrgId).maybeSingle(),
      getOrgEnabledPluginIds(supabase, currentOrgId).catch(() => ungatedPluginIds()),
    ]);
    inventoryEnabled = (orgData.data as { inventory_enabled: boolean } | null)?.inventory_enabled ?? false;
    orgPluginIds = pluginIds;
  }

  const currentOrg = organizations.find((org) => org.id === currentOrgId) ?? null;

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar
        showInventory={inventoryEnabled}
        showSiteAdmin={siteAdmin}
        workspaceType={currentOrg?.workspace_type ?? "business"}
        orgName={currentOrg?.name}
        orgLogoDataUrl={currentOrg?.logoDataUrl}
        sourceCodeUrl={getSourceCodeUrl()}
        pluginPages={pluginPageLinks(currentOrg?.workspace_type ?? "business", orgPluginIds)}
      />
      <div className="flex flex-1 flex-col">
        <Header organizations={organizations} currentOrgId={currentOrgId} role={role} />
        <main className="flex-1 px-4 py-6 md:px-8">
          {orgStatus === "suspended" && (
            <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="font-medium">This organization has been suspended.</p>
              <p className="mt-1 text-amber-800">
                Contact your Site Admin to restore access.
                {role === "owner" && (
                  <>
                    {" "}
                    You can still{" "}
                    <DownloadButton
                      href="/api/export/organization"
                      label="download a full backup"
                      className="underline"
                    />{" "}
                    of your data.
                  </>
                )}
              </p>
            </div>
          )}
          <BookClockProvider timeZone={bookClock.timeZone} changes={bookClock.changes}>
            <BookCurrencyProvider currency={currency}>
              <EnabledPluginsProvider ids={orgPluginIds}>{children}</EnabledPluginsProvider>
            </BookCurrencyProvider>
          </BookClockProvider>
          {canWrite(role) && <UncategorizedToast />}
        </main>
      </div>
    </div>
  );
}
