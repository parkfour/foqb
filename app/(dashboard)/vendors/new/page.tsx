import { redirect } from "next/navigation";
import { VendorForm } from "@/components/vendors/vendor-form";
import { ReadOnlyNotice } from "@/components/ui/read-only-notice";
import { canWrite, getCurrentOrgId, getCurrentUserRole } from "@/lib/org/current";

export default async function NewVendorPage() {
  const orgId = await getCurrentOrgId();

  if (!orgId) {
    redirect("/");
  }

  if (!canWrite(await getCurrentUserRole(orgId))) {
    return <ReadOnlyNotice />;
  }

  return <VendorForm organizationId={orgId} />;
}
