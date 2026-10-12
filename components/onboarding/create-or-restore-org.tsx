import { createClient } from "@/lib/supabase/server";
import { CreateOrgForm } from "@/components/onboarding/create-org-form";
import { RestoreOrgForm } from "@/components/onboarding/restore-org-form";

interface DeletedOrgNotice {
  organization_name: string;
  deleted_at: string;
}

// Shared by the dashboard's zero-org empty state and /organizations/new
// (reachable from the org switcher for a user who already has one) — same
// entry point, two places to reach it from.
export async function CreateOrRestoreOrg() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_my_deleted_org_notices");
  const notices = (data as DeletedOrgNotice[] | null) ?? [];

  return (
    <div className="flex flex-col gap-4">
      {notices.map((notice, i) => (
        <div
          key={i}
          className="mx-auto w-full max-w-md rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
        >
          Your organization &ldquo;{notice.organization_name}&rdquo; was deleted on{" "}
          {new Date(notice.deleted_at).toLocaleDateString()}.
        </div>
      ))}
      <CreateOrgForm />
      <RestoreOrgForm />
    </div>
  );
}
