import { redirect } from "next/navigation";
import { CustomerForm } from "@/components/customers/customer-form";
import { ReadOnlyNotice } from "@/components/ui/read-only-notice";
import { canWrite, getCurrentOrgId, getCurrentUserRole } from "@/lib/org/current";

export default async function NewCustomerPage() {
  const orgId = await getCurrentOrgId();

  if (!orgId) {
    redirect("/");
  }

  if (!canWrite(await getCurrentUserRole(orgId))) {
    return <ReadOnlyNotice />;
  }

  return <CustomerForm organizationId={orgId} />;
}
