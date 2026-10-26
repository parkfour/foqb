import { redirect } from "next/navigation";
import { MakePaymentForm } from "@/components/vendors/make-payment-form";
import { ReadOnlyNotice } from "@/components/ui/read-only-notice";
import { createClient } from "@/lib/supabase/server";
import { canWrite, getCurrentOrgId, getCurrentUserRole, getUseAccountCodes } from "@/lib/org/current";

export default async function MakePaymentPage() {
  const orgId = await getCurrentOrgId();

  if (!orgId) {
    redirect("/");
  }

  if (!canWrite(await getCurrentUserRole(orgId))) {
    return <ReadOnlyNotice />;
  }

  const supabase = await createClient();

  const [
    { data: vendors },
    { data: bills },
    { data: accounts },
    { data: bankTransactions },
    showAccountCodes,
  ] = await Promise.all([
      supabase
        .from("vendors")
        .select("id, name")
        .eq("organization_id", orgId)
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("bills")
        .select("id, bill_number, vendor_id, bill_lines(amount), bill_payments(amount)")
        .eq("organization_id", orgId)
        .in("status", ["open", "partial"])
        .order("bill_date"),
      supabase
        .from("accounts")
        .select("id, account_number, name")
        .eq("organization_id", orgId)
        .eq("is_active", true)
        .is("currency", null)
        .eq("type", "asset")
        .order("account_number"),
      supabase
        .from("bank_transactions")
        .select("id, date, name, amount")
        .eq("organization_id", orgId)
        .eq("status", "unreconciled")
        .lt("amount", 0)
        .order("date", { ascending: false }),
      getUseAccountCodes(orgId),
    ]);

  interface RawBill {
    id: string;
    bill_number: string;
    vendor_id: string;
    bill_lines: { amount: number }[];
    bill_payments: { amount: number }[];
  }

  const openBills = ((bills as unknown as RawBill[] | null) ?? []).map((bill) => {
    const total = bill.bill_lines.reduce((sum, l) => sum + Number(l.amount), 0);
    const paid = bill.bill_payments.reduce((sum, p) => sum + Number(p.amount), 0);
    return {
      id: bill.id,
      billNumber: bill.bill_number,
      vendorId: bill.vendor_id,
      remaining: Math.round((total - paid) * 100) / 100,
    };
  });

  return (
    <MakePaymentForm
      vendors={vendors ?? []}
      bills={openBills}
      accounts={accounts ?? []}
      bankTransactions={bankTransactions ?? []}
      showAccountCodes={showAccountCodes}
    />
  );
}
