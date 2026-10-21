"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchBeginningBalance, fetchReconciliation, signedAmount } from "@/lib/reconcile";

export async function startReconciliation(formData: FormData): Promise<void> {
  const organizationId = formData.get("organizationId") as string;
  const accountId = formData.get("accountId") as string;
  const statementDate = formData.get("statementDate") as string;
  const statementEndingBalance = Number(formData.get("statementEndingBalance"));

  if (!organizationId || !accountId || !statementDate || Number.isNaN(statementEndingBalance)) {
    return;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const id = randomUUID();
  const { error } = await supabase.from("bank_reconciliations").insert({
    id,
    organization_id: organizationId,
    account_id: accountId,
    statement_date: statementDate,
    statement_ending_balance: statementEndingBalance,
    created_by: user?.id,
  });

  if (error) return;

  redirect(`/reconcile/${id}`);
}

export async function cancelReconciliation(formData: FormData): Promise<void> {
  const id = formData.get("id") as string;
  if (!id) return;

  const supabase = await createClient();
  // Only in-progress reconciliations have no cleared lines pointing at them
  // yet, so this can't orphan anything — matches the delete guard.
  await supabase.from("bank_reconciliations").delete().eq("id", id).eq("status", "in_progress");

  revalidatePath("/reconcile");
}

export async function finishReconciliation(formData: FormData): Promise<void> {
  const reconciliationId = formData.get("reconciliationId") as string;
  const organizationId = formData.get("organizationId") as string;
  const lineIds = formData.getAll("lineIds") as string[];
  if (!reconciliationId || !organizationId) return;

  const reconciliation = await fetchReconciliation(organizationId, reconciliationId);
  if (!reconciliation || reconciliation.status !== "in_progress") return;

  const supabase = await createClient();

  // Recompute server-side rather than trusting the client's displayed
  // difference — a stale or tampered form shouldn't be able to force a
  // reconciliation closed out of balance.
  const [beginningBalance, { data: selectedLines }] = await Promise.all([
    fetchBeginningBalance(reconciliation.accountId, reconciliation.accountType, reconciliationId),
    supabase.from("journal_lines").select("id, debit, credit").in("id", lineIds),
  ]);

  const clearedTotal = ((selectedLines as { debit: number; credit: number }[] | null) ?? []).reduce(
    (sum, l) => sum + signedAmount(reconciliation.accountType, Number(l.debit), Number(l.credit)),
    0,
  );

  const difference =
    reconciliation.statementEndingBalance - (beginningBalance + clearedTotal);

  if (Math.abs(difference) > 0.005) {
    redirect(`/reconcile/${reconciliationId}?error=Not+balanced+yet`);
  }

  if (lineIds.length > 0) {
    const { error: clearError } = await supabase
      .from("journal_lines")
      .update({ reconciliation_id: reconciliationId })
      .in("id", lineIds);

    if (clearError) return;
  }

  await supabase
    .from("bank_reconciliations")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", reconciliationId);

  redirect("/reconcile");
}
