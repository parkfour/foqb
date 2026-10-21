import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { ConnectBankButton } from "@/components/settings/connect-bank-button";
import { getCurrentOrgId } from "@/lib/org/current";
import { createClient } from "@/lib/supabase/server";
import { linkableAccounts } from "@/lib/plaid/bank-linking";

// PLAID_REDIRECT_URI points here: after a bank's own sign-in page (OAuth),
// Plaid sends the tab back to this page, which re-opens Link to finish.
export default async function BankReturnPage() {
  const orgId = await getCurrentOrgId();
  const accounts = orgId ? await linkableAccounts(await createClient(), orgId) : [];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Finishing bank connection" description="Returning from your bank's sign-in page." />
      {orgId ? (
        <ConnectBankButton organizationId={orgId} resumeOAuth linkableAccounts={accounts} />
      ) : (
        <p className="text-sm text-slate-500">Create an organization first.</p>
      )}
      <Link href="/settings" className="text-sm text-slate-500 hover:text-slate-900">
        Back to Settings
      </Link>
    </div>
  );
}
