import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hasPassedMfa, MFA_REQUIRED_FOR_BANKS } from "@/lib/auth/mfa";
import { encryptToken } from "@/lib/crypto/token-encryption";
import { canWrite, type MemberRole } from "@/lib/org/current";
import { bankLinkingBlockedReason } from "@/lib/plaid/bank-linking";
import { nextAccountNumbers } from "@/lib/org/account-numbering";
import { claimSetupToken, externalAccountId, getAccountSet, simplefinAccountType } from "@/lib/simplefin/client";
import { syncSimplefinEnrollment } from "@/lib/simplefin/sync";

// Connects the banks behind a SimpleFIN setup token: claims it, adds a
// ledger account for each bank account not already linked, and pulls the
// last 90 days.
export async function POST(req: NextRequest) {
  const { organizationId, setupToken } = (await req.json().catch(() => ({}))) as {
    organizationId?: string;
    setupToken?: string;
  };
  if (!organizationId || !setupToken?.trim()) {
    return NextResponse.json({ error: "Paste the setup token from your SimpleFIN Bridge" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPassedMfa(supabase))) return NextResponse.json({ error: MFA_REQUIRED_FOR_BANKS }, { status: 403 });

  const blocked = await bankLinkingBlockedReason(supabase, organizationId);
  if (blocked) return NextResponse.json({ error: blocked }, { status: 403 });

  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .maybeSingle();
  // Before claiming: a token works once, so a refused request mustn't use it up.
  if (!canWrite((membership?.role as MemberRole | undefined) ?? null)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let accessUrl: string;
  let accounts;
  try {
    accessUrl = await claimSetupToken(setupToken);
    accounts = (await getAccountSet(accessUrl, null, true)).accounts;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Couldn't reach SimpleFIN" }, { status: 400 });
  }
  if (accounts.length === 0) {
    return NextResponse.json({ error: "No bank accounts are connected at your SimpleFIN Bridge yet" }, { status: 400 });
  }

  // An account connected before (a new token for the same bank) keeps its
  // ledger account.
  const { data: existing } = await supabase
    .from("accounts")
    .select("external_account_id")
    .eq("organization_id", organizationId)
    .in("external_account_id", accounts.map(externalAccountId));
  const known = new Set(((existing ?? []) as { external_account_id: string }[]).map((a) => a.external_account_id));
  const fresh = accounts.filter((a) => !known.has(externalAccountId(a)));

  if (fresh.length > 0) {
    const types = fresh.map(simplefinAccountType);
    const numbers = await nextAccountNumbers(supabase, organizationId, types);
    const { error } = await supabase.from("accounts").insert(
      fresh.map((account, i) => ({
        organization_id: organizationId,
        account_number: numbers[i],
        name: account.name,
        type: types[i],
        description: `Linked via SimpleFIN${account.org?.name ? ` (${account.org.name})` : ""}`,
        external_account_id: externalAccountId(account),
      })),
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const banks = [...new Set(accounts.map((a) => a.org?.name).filter(Boolean))];
  const enrollmentId = randomUUID();
  const { error: enrollmentError } = await supabase.from("enrollments").insert({
    id: enrollmentId,
    organization_id: organizationId,
    provider: "simplefin",
    external_item_id: `sfin:${enrollmentId}`,
    access_token: encryptToken(accessUrl),
    institution_name: `SimpleFIN: ${banks.join(", ") || "your banks"}`.slice(0, 100),
    cursor: null,
  });
  if (enrollmentError) return NextResponse.json({ error: enrollmentError.message }, { status: 500 });

  // Best-effort: the timer job tries again if this fails.
  try {
    await syncSimplefinEnrollment(enrollmentId);
  } catch (error) {
    console.error("Failed the first SimpleFIN sync", error);
  }
  return NextResponse.json({ success: true, accounts: accounts.length });
}
