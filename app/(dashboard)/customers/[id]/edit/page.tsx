import { notFound, redirect } from "next/navigation";
import { CustomerForm } from "@/components/customers/customer-form";
import { ReadOnlyNotice } from "@/components/ui/read-only-notice";
import { createClient } from "@/lib/supabase/server";
import { canWrite, getCurrentOrgId, getCurrentUserRole } from "@/lib/org/current";

export default async function EditCustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const orgId = await getCurrentOrgId();

  if (!orgId) {
    redirect("/");
  }

  if (!canWrite(await getCurrentUserRole(orgId))) {
    return <ReadOnlyNotice />;
  }

  const supabase = await createClient();
  const { data: customer } = await supabase
    .from("customers")
    .select("id, name, email, phone, billing_address")
    .eq("id", id)
    .maybeSingle();

  if (!customer) {
    notFound();
  }

  return <CustomerForm organizationId={orgId} customer={customer} />;
}
