"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/app/(dashboard)/actions";

export async function createRule(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const organizationId = formData.get("organizationId") as string;
  const targetAccountId = formData.get("targetAccountId") as string;
  const ruleName = (formData.get("ruleName") as string)?.trim();
  const matchType = formData.get("matchType") as string;
  const matchText = (formData.get("matchText") as string)?.trim();
  const transactionType = (formData.get("transactionType") as string) || "any";
  const minAmountRaw = (formData.get("minAmount") as string)?.trim();
  const maxAmountRaw = (formData.get("maxAmount") as string)?.trim();
  const priorityRaw = (formData.get("priority") as string)?.trim();

  if (!organizationId || !targetAccountId || !ruleName || !matchType || !matchText) {
    return { error: "Account, rule name, match type, and match text are required" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("categorization_rules").insert({
    organization_id: organizationId,
    target_account_id: targetAccountId,
    rule_name: ruleName,
    match_type: matchType,
    match_text: matchText,
    transaction_type: transactionType,
    min_amount: minAmountRaw ? Number(minAmountRaw) : null,
    max_amount: maxAmountRaw ? Number(maxAmountRaw) : null,
    priority: priorityRaw ? Number(priorityRaw) : 10,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/rules");
  return { error: null };
}

export async function toggleRuleActive(formData: FormData): Promise<void> {
  const id = formData.get("id") as string;
  const isActive = formData.get("isActive") === "true";
  if (!id) return;

  const supabase = await createClient();
  await supabase.from("categorization_rules").update({ is_active: !isActive }).eq("id", id);

  revalidatePath("/rules");
}

export async function deleteRule(formData: FormData): Promise<void> {
  const id = formData.get("id") as string;
  if (!id) return;

  const supabase = await createClient();
  await supabase.from("categorization_rules").delete().eq("id", id);

  revalidatePath("/rules");
}
