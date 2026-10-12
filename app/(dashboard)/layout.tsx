import type { ReactNode } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { DownloadButton } from "@/components/ui/download-button";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId, getCurrentUserRole, getOrgStatus, getUserOrganizations } from "@/lib/org/current";
import { isSiteAdmin } from "@/lib/org/site-admin";
import { requireCurrentPolicyAcceptance } from "@/lib/legal/policy";
import { getSourceCodeUrl } from "@/lib/legal/source-code";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  await requireCurrentPolicyAcceptance();

  const [currentOrgId, organizations, siteAdmin] = await Promise.all([
    getCurrentOrgId(),
    getUserOrganizations(),
    isSiteAdmin(),
  ]);
  const [role, orgStatus] = await Promise.all([
    getCurrentUserRole(currentOrgId),
    getOrgStatus(currentOrgId),
  ]);

  let inventoryEnabled = false;
  if (currentOrgId) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("organizations")
      .select("inventory_enabled")
      .eq("id", currentOrgId)
      .maybeSingle();
    inventoryEnabled = (data as { inventory_enabled: boolean } | null)?.inventory_enabled ?? false;
  }

  const currentOrg = organizations.find((org) => org.id === currentOrgId) ?? null;

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar
        showInventory={inventoryEnabled}
        showSiteAdmin={siteAdmin}
        orgName={currentOrg?.name}
        orgLogoDataUrl={currentOrg?.logoDataUrl}
        sourceCodeUrl={getSourceCodeUrl()}
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
          {children}
        </main>
      </div>
    </div>
  );
}
