import { redirect } from "next/navigation";
import { CreditMemoForm } from "@/components/customers/credit-memo-form";
import { ReadOnlyNotice } from "@/components/ui/read-only-notice";
import { createClient } from "@/lib/supabase/server";
import { canWrite, getCurrentOrgId, getCurrentUserRole, getUseAccountCodes } from "@/lib/org/current";
import { fetchOpenInvoices } from "@/lib/ar/open-invoices";

export default async function NewCreditMemoPage() {
  const orgId = await getCurrentOrgId();
  if (!orgId) redirect("/");
  if (!canWrite(await getCurrentUserRole(orgId))) return <ReadOnlyNotice />;

  const supabase = await createClient();
  const [{ data: customers }, { data: accounts }, invoices, showAccountCodes] = await Promise.all([
    supabase.from("customers").select("id, name").eq("organization_id", orgId).eq("is_active", true).order("name"),
    supabase
      .from("accounts")
      .select("id, account_number, name, type")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .is("currency", null)
      .in("type", ["revenue", "liability"])
      .order("type", { ascending: false })
      .order("account_number"),
    fetchOpenInvoices(supabase, orgId),
    getUseAccountCodes(orgId),
  ]);

  return (
    <CreditMemoForm customers={customers ?? []} accounts={accounts ?? []} invoices={invoices} showAccountCodes={showAccountCodes} />
  );
}
