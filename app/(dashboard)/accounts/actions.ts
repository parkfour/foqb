"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/app/(dashboard)/actions";
import type { DefaultAccount } from "@/lib/org/default-accounts";
import { nextAccountNumber } from "@/lib/org/account-numbering";

export async function createAccount(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const organizationId = formData.get("organizationId") as string;
  const accountNumberInput = (formData.get("accountNumber") as string)?.trim();
  const name = (formData.get("name") as string)?.trim();
  const type = formData.get("type") as DefaultAccount["type"];
  const description = ((formData.get("description") as string) || "").trim() || null;
  const taxLineId = (formData.get("taxLineId") as string) || null;

  if (!organizationId || !name || !type) {
    return { error: "Name and type are required" };
  }

  const supabase = await createClient();

  const { data: org } = await supabase
    .from("organizations")
    .select("use_account_codes")
    .eq("id", organizationId)
    .maybeSingle();
  const useAccountCodes = (org as { use_account_codes: boolean } | null)?.use_account_codes ?? true;

  if (useAccountCodes && !accountNumberInput) {
    return { error: "Account number, name, and type are required" };
  }

  const accountNumber = useAccountCodes
    ? accountNumberInput
    : await nextAccountNumber(supabase, organizationId, type);

  const { error } = await supabase.from("accounts").insert({
    organization_id: organizationId,
    account_number: accountNumber,
    name,
    type,
    description,
    tax_line_id: taxLineId,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/accounts");
  return { error: null };
}

export async function deleteAccount(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = formData.get("id") as string;
  if (!id) return { error: "Missing account id" };

  const supabase = await createClient();
  const { error } = await supabase.from("accounts").delete().eq("id", id);

  if (error) {
    // Postgres foreign_key_violation — the account has journal lines or
    // other records pointing at it. Deactivating (see toggleAccountActive)
    // is the escape hatch for that case; a hard delete only ever works for
    // an account nothing has referenced yet.
    if (error.code === "23503") {
      return {
        error: "This account has existing transactions and can't be deleted — deactivate it instead.",
      };
    }
    return { error: error.message };
  }

  revalidatePath("/accounts");
  return { error: null };
}

export async function toggleAccountActive(formData: FormData): Promise<void> {
  const id = formData.get("id") as string;
  const isActive = formData.get("isActive") === "true";
  if (!id) return;

  const supabase = await createClient();
  await supabase.from("accounts").update({ is_active: !isActive }).eq("id", id);

  revalidatePath("/accounts");
}

export async function updateAccountTaxLine(formData: FormData): Promise<void> {
  const id = formData.get("id") as string;
  if (!id) return;

  const taxLineId = (formData.get("taxLineId") as string) || null;

  const supabase = await createClient();
  await supabase.from("accounts").update({ tax_line_id: taxLineId }).eq("id", id);

  revalidatePath("/accounts");
}
