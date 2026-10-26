import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { PluginPageHost } from "@/components/plugins/plugin-page";
import { canWrite, getCurrentOrgId, getCurrentUserRole, getUserOrganizations, getWorkspaceType } from "@/lib/org/current";
import { createClient } from "@/lib/supabase/server";
import { ungatedPluginIds } from "@/lib/plugins/acknowledgements";
import { getOrgEnabledPluginIds } from "@/lib/plugins/settings";
import { findPluginPage } from "@/lib/plugins/pages";

export default async function PluginPageRoute({ params }: { params: Promise<{ pluginId: string; slug: string }> }) {
  const { pluginId, slug } = await params;
  const orgId = await getCurrentOrgId();
  if (!orgId) redirect("/");

  const supabase = await createClient();
  const [workspaceType, role, organizations, orgPluginIds] = await Promise.all([
    getWorkspaceType(orgId),
    getCurrentUserRole(orgId),
    getUserOrganizations(),
    getOrgEnabledPluginIds(supabase, orgId).catch(() => ungatedPluginIds()),
  ]);
  const page = findPluginPage(pluginId, slug, workspaceType, orgPluginIds);
  if (!page) notFound();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={page.title} description={page.description ?? ""} />
      <PluginPageHost
        pluginId={pluginId}
        slug={slug}
        context={{
          organizationId: orgId,
          workspaceType,
          canWrite: canWrite(role),
          books: organizations.map((o) => ({ id: o.id, name: o.name, workspaceType: o.workspace_type ?? "business", currency: o.currency ?? "USD" })),
        }}
      />
    </div>
  );
}
