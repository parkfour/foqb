import { redirect } from "next/navigation";
import { BillForm } from "@/components/vendors/bill-form";
import { ReadOnlyNotice } from "@/components/ui/read-only-notice";
import { createClient } from "@/lib/supabase/server";
import { fetchActiveClasses } from "@/lib/org/classes";
import { canWrite, getCurrentOrgId, getCurrentUserRole, getUseAccountCodes } from "@/lib/org/current";

export default async function NewBillPage() {
  const orgId = await getCurrentOrgId();

  if (!orgId) {
    redirect("/");
  }

  if (!canWrite(await getCurrentUserRole(orgId))) {
    return <ReadOnlyNotice />;
  }

  const supabase = await createClient();
  const classes = await fetchActiveClasses(supabase, orgId);

  const [{ data: vendors }, { data: accounts }, { data: stockItems }, showAccountCodes] = await Promise.all([
    supabase
      .from("vendors")
      .select("id, name")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("accounts")
      .select("id, account_number, name")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .is("currency", null)
      .in("type", ["expense", "asset"])
      .order("account_number"),
    supabase
      .from("items")
      .select("id, name, inventory_account_id")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .eq("track_quantity", true)
      .not("inventory_account_id", "is", null)
      .not("cogs_account_id", "is", null)
      .order("name"),
    getUseAccountCodes(orgId),
  ]);

  return (
    <BillForm
      organizationId={orgId}
      vendors={vendors ?? []}
      accounts={accounts ?? []}
      showAccountCodes={showAccountCodes}
      stockItems={(stockItems ?? []) as { id: string; name: string; inventory_account_id: string }[]}
      classes={classes}
    />
  );
}
