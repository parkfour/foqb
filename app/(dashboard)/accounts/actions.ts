"use server";

import { isValidCurrency } from "@/lib/money";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/app/(dashboard)/actions";
import type { DefaultAccount } from "@/lib/org/default-accounts";
import { nextAccountNumber } from "@/lib/org/account-numbering";
import { getCurrentOrgId } from "@/lib/org/current";

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
  const currencyInput = ((formData.get("currency") as string) || "").trim().toUpperCase();

  if (!organizationId || !name || !type) {
    return { error: "Name and type are required" };
  }
  if (currencyInput && !isValidCurrency(currencyInput)) {
    return { error: `${currencyInput} isn't a currency code` };
  }
  if (currencyInput && type !== "asset" && type !== "liability") {
    return { error: "Only an asset or liability account can be in another currency" };
  }

  const supabase = await createClient();

  const { data: org } = await supabase
    .from("organizations")
    .select("use_account_codes, currency")
    .eq("id", organizationId)
    .maybeSingle();
  const useAccountCodes = (org as { use_account_codes: boolean } | null)?.use_account_codes ?? true;
  const bookCurrency = (org as { currency: string | null } | null)?.currency ?? "USD";

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
    currency: currencyInput && currencyInput !== bookCurrency ? currencyInput : null,
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

export async function updateAccountTaxLine(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const id = formData.get("id") as string;
  if (!id) return { error: "No account to save" };

  const taxLineId = (formData.get("taxLineId") as string) || null;
  // Only a Schedule E line asks for the property; any other line clears it.
  const propertyId = (formData.get("propertyId") as string) || null;

  const supabase = await createClient();
  const { error } = await supabase
    .from("accounts")
    .update({ tax_line_id: taxLineId, property_id: taxLineId ? propertyId : null })
    .eq("id", id);
  if (error) return { error: `Couldn't save the tax line: ${error.message}` };

  revalidatePath("/accounts");
  return { error: null };
}

// Name, number, description and type. The database refuses a type change
// once the account has transactions (guard_account_type_change).
export async function updateAccount(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const id = formData.get("id") as string;
  const name = ((formData.get("name") as string) || "").trim();
  const accountNumber = ((formData.get("accountNumber") as string) || "").trim();
  const description = ((formData.get("description") as string) || "").trim() || null;
  const type = formData.get("type") as DefaultAccount["type"];
  if (!id || !name || !type) return { error: "Name and type are required" };

  const update: Record<string, unknown> = { name, description, type };
  if (formData.has("accountNumber")) {
    if (!accountNumber) return { error: "Account number is required" };
    update.account_number = accountNumber;
  }

  const supabase = await createClient();
  const { error } = await supabase.from("accounts").update(update).eq("id", id);
  if (error) {
    if (error.code === "23505") return { error: "Another account already has that number" };
    return { error: error.message };
  }

  revalidatePath("/accounts");
  return { error: null };
}

const QUICK_ACCOUNT_TYPES = new Set(["asset", "liability", "equity", "revenue", "expense"]);

// From the register's category list: a new account with the next free
// number in its type's block, returned so the row can be categorized to it.
export async function createAccountQuickAction(
  name: string,
  type: string,
): Promise<{ success: boolean; account?: { id: string; name: string; account_number: string; type: string }; error?: string }> {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 100) return { success: false, error: "Enter a name (up to 100 characters)" };
  if (!QUICK_ACCOUNT_TYPES.has(type)) return { success: false, error: "Choose an account type" };

  const organizationId = await getCurrentOrgId();
  if (!organizationId) return { success: false, error: "No book selected" };

  const supabase = await createClient();
  const accountType = type as DefaultAccount["type"];
  const accountNumber = await nextAccountNumber(supabase, organizationId, accountType);
  const { data, error } = await supabase
    .from("accounts")
    .insert({ organization_id: organizationId, account_number: accountNumber, name: trimmed, type: accountType })
    .select("id, name, account_number, type")
    .single();
  if (error || !data) return { success: false, error: error?.message ?? "Couldn't create the account" };

  revalidatePath("/accounts");
  revalidatePath("/register");
  return { success: true, account: data };
}
