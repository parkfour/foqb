"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { recordDepreciation } from "@/lib/fixed-assets/depreciate";

interface CreateFixedAssetInput {
  organizationId: string;
  name: string;
  assetAccountId: string;
  accumulatedDepreciationAccountId: string;
  depreciationExpenseAccountId: string;
  purchaseDate: string;
  cost: number;
  salvageValue: number;
  usefulLifeMonths: number;
}

export async function createFixedAsset(
  input: CreateFixedAssetInput,
): Promise<{ error: string | null }> {
  if (
    !input.name ||
    !input.assetAccountId ||
    !input.accumulatedDepreciationAccountId ||
    !input.depreciationExpenseAccountId ||
    !input.purchaseDate ||
    !input.cost ||
    !input.usefulLifeMonths
  ) {
    return { error: "Name, accounts, purchase date, cost, and useful life are required" };
  }

  if (input.salvageValue >= input.cost) {
    return { error: "Salvage value must be less than cost" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("fixed_assets").insert({
    id: randomUUID(),
    organization_id: input.organizationId,
    name: input.name,
    asset_account_id: input.assetAccountId,
    accumulated_depreciation_account_id: input.accumulatedDepreciationAccountId,
    depreciation_expense_account_id: input.depreciationExpenseAccountId,
    purchase_date: input.purchaseDate,
    cost: input.cost,
    salvage_value: input.salvageValue,
    useful_life_months: input.usefulLifeMonths,
    next_depreciation_date: input.purchaseDate,
  });

  if (error) return { error: error.message };

  revalidatePath("/fixed-assets");
  redirect("/fixed-assets");
}

export async function recordDepreciationNow(formData: FormData): Promise<void> {
  const id = formData.get("id") as string;
  const organizationId = formData.get("organizationId") as string;
  if (!id || !organizationId) return;

  await recordDepreciation(organizationId, id);
  revalidatePath("/fixed-assets");
}

export async function deleteFixedAsset(formData: FormData): Promise<void> {
  const id = formData.get("id") as string;
  if (!id) return;

  const supabase = await createClient();
  await supabase.from("fixed_assets").delete().eq("id", id);
  revalidatePath("/fixed-assets");
}
