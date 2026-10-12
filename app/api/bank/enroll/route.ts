import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hasPassedMfa, MFA_REQUIRED_FOR_BANKS } from "@/lib/auth/mfa";
import { exchangePublicToken, getAccounts, removeItem } from "@/lib/plaid/client";
import { syncItem } from "@/lib/plaid/sync";
import { encryptToken } from "@/lib/crypto/token-encryption";
import { nextAccountNumbers } from "@/lib/org/account-numbering";
import { canWrite, type MemberRole } from "@/lib/org/current";
import { bankLinkingBlockedReason } from "@/lib/plaid/bank-linking";

interface EnrollRequestBody {
  publicToken: string;
  institutionName?: string;
  organizationId: string;
  // When omitted, every account Plaid returns is imported (back-compat for
  // callers that skip the account-selection step).
  selectedAccountIds?: string[];
  // From Link's onSuccess metadata — used only to refuse linking a bank
  // that's already connected (see findDuplicateEnrollment).
  institutionId?: string;
  accountMasks?: string[];
}

// Plaid's recommended duplicate check: same institution with at least one
// account mask in common. Run before the token exchange, so a duplicate
// never becomes a live (billed) Item that would re-import everything.
async function isAlreadyConnected(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string,
  institutionId: string,
  accountMasks: string[],
): Promise<boolean> {
  const masks = new Set(accountMasks.filter(Boolean));
  if (masks.size === 0) return false;

  const { data } = await supabase
    .from("enrollments")
    .select("account_masks")
    .eq("organization_id", organizationId)
    .eq("institution_id", institutionId)
    .neq("status", "disconnected");

  return ((data as { account_masks: string[] }[] | null) ?? []).some((row) =>
    row.account_masks.some((mask) => masks.has(mask)),
  );
}

// Plaid's own account `type` (depository/credit/loan/investment/other) tells
// us which side of the balance sheet an account belongs on — a credit card
// or loan is money owed, not money held. Only "credit" and "loan" are debt;
// everything else (depository, investment, other) is money the org has.
function mapPlaidAccountType(plaidType: string): "asset" | "liability" {
  return plaidType === "credit" || plaidType === "loan" ? "liability" : "asset";
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Partial<EnrollRequestBody>;
  const { publicToken, institutionName, organizationId, selectedAccountIds, institutionId, accountMasks } = body;

  if (!publicToken || !organizationId) {
    return NextResponse.json(
      { error: "publicToken and organizationId are required" },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await hasPassedMfa(supabase))) {
    return NextResponse.json({ error: MFA_REQUIRED_FOR_BANKS }, { status: 403 });
  }

  const blocked = await bankLinkingBlockedReason(supabase, organizationId);
  if (blocked) {
    return NextResponse.json({ error: blocked }, { status: 403 });
  }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .maybeSingle();

  // Checked before the token exchange: exchanging creates a live (billed)
  // Plaid Item, which a viewer's request would otherwise leave orphaned
  // when RLS refuses the writes below.
  if (!canWrite((membership?.role as MemberRole | undefined) ?? null)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (institutionId && (await isAlreadyConnected(supabase, organizationId, institutionId, accountMasks ?? []))) {
    return NextResponse.json(
      {
        error:
          "That bank account is already connected. If it stopped syncing, use Reconnect on it instead of connecting it again.",
      },
      { status: 409 },
    );
  }

  const { accessToken, itemId } = await exchangePublicToken(publicToken);

  // Undoes the exchange when saving fails, so no Plaid Item is left live
  // (and billed) without an enrollment that syncs it.
  async function fail(message: string) {
    await removeItem(accessToken).catch((error) =>
      console.error(`Failed to remove Plaid Item ${itemId} after a failed enrollment`, error),
    );
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const allAccounts = await getAccounts(accessToken);
  const accounts = selectedAccountIds
    ? allAccounts.filter((account) => selectedAccountIds.includes(account.id))
    : allAccounts;

  // Ledger accounts first: the enrollment is what makes webhooks start
  // syncing, and a sync that finds no ledger account for a Plaid account
  // skips its transactions.
  if (accounts.length > 0) {
    const types = accounts.map((account) => mapPlaidAccountType(account.type));
    const accountNumbers = await nextAccountNumbers(supabase, organizationId, types);

    const accountRows = accounts.map((account, i) => ({
      organization_id: organizationId,
      account_number: accountNumbers[i],
      // account.name is already human-readable (Plaid's own or the bank's
      // nickname for it) — the mask disambiguates two accounts that would
      // otherwise share the same name (e.g. two checking accounts).
      name: account.mask ? `${account.name} ••${account.mask}` : account.name,
      type: types[i],
      description: "Linked via Plaid",
      external_account_id: account.id,
    }));

    const { error: accountsError } = await supabase.from("accounts").insert(accountRows);
    if (accountsError) return fail(accountsError.message);
  }

  // No cursor yet: the first sync (below, and any webhook) pulls the full
  // history from the start, every page of it.
  const { error: enrollmentError } = await supabase.from("enrollments").insert({
    organization_id: organizationId,
    external_item_id: itemId,
    access_token: encryptToken(accessToken),
    institution_name: institutionName ?? null,
    institution_id: institutionId ?? null,
    // From Plaid's own account list, not the client's.
    account_masks: accounts.map((account) => account.mask).filter((mask): mask is string => !!mask),
    cursor: null,
  });
  if (enrollmentError) return fail(enrollmentError.message);

  // Best-effort backfill so the ledger isn't empty until the next Plaid
  // webhook fires; a failure here leaves the cursor unsaved, so that
  // webhook picks up from the start.
  try {
    await syncItem(itemId);
  } catch (error) {
    console.error("Failed to backfill transactions during enrollment", error);
  }

  return NextResponse.json({ success: true });
}
