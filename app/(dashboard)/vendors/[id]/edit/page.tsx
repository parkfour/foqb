import { notFound, redirect } from "next/navigation";
import { VendorForm } from "@/components/vendors/vendor-form";
import { ReadOnlyNotice } from "@/components/ui/read-only-notice";
import { createClient } from "@/lib/supabase/server";
import { canWrite, getCurrentOrgId, getCurrentUserRole } from "@/lib/org/current";

export default async function EditVendorPage({
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
  const { data: vendor } = await supabase
    .from("vendors")
    .select("id, name, email, phone, address, is_1099")
    .eq("id", id)
    .maybeSingle();

  if (!vendor) {
    notFound();
  }

  return <VendorForm organizationId={orgId} vendor={vendor} />;
}
