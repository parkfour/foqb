import { PageHeader } from "@/components/ui/page-header";
import { CreateOrRestoreOrg } from "@/components/onboarding/create-or-restore-org";

export default function NewOrganizationPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Create or restore an organization"
        description="Start a new organization, or restore one from a backup file."
      />
      <CreateOrRestoreOrg />
    </div>
  );
}
