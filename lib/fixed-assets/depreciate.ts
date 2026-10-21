import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";

export interface FixedAssetRow {
  id: string;
  organization_id: string;
  name: string;
  asset_account_id: string;
  accumulated_depreciation_account_id: string;
  depreciation_expense_account_id: string;
  cost: number;
  salvage_value: number;
  useful_life_months: number;
  accumulated_months: number;
  next_depreciation_date: string;
  is_active: boolean;
}

// Straight-line only — the common case, and the only one worth building
// until a real need for declining-balance/MACRS shows up.
export function monthlyDepreciationAmount(
  asset: Pick<FixedAssetRow, "cost" | "salvage_value" | "useful_life_months">,
): number {
  return Math.round(((asset.cost - asset.salvage_value) / asset.useful_life_months) * 100) / 100;
}

export function advanceOneMonth(date: string): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return next.toISOString().slice(0, 10);
}

export async function recordDepreciation(
  orgId: string,
  assetId: string,
): Promise<{ id: string } | { error: string }> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data } = await supabase
    .from("fixed_assets")
    .select(
      "id, organization_id, name, asset_account_id, accumulated_depreciation_account_id, depreciation_expense_account_id, cost, salvage_value, useful_life_months, accumulated_months, next_depreciation_date, is_active",
    )
    .eq("id", assetId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (!data) return { error: "Fixed asset not found" };

  const asset = data as FixedAssetRow;

  if (asset.accumulated_months >= asset.useful_life_months) {
    return { error: "This asset is already fully depreciated" };
  }

  const amount = monthlyDepreciationAmount(asset);
  const entryId = randomUUID();

  const { error: entryError } = await supabase.from("journal_entries").insert({
    id: entryId,
    organization_id: orgId,
    entry_date: asset.next_depreciation_date,
    memo: `Depreciation: ${asset.name}`,
    status: "draft",
    created_by: user?.id,
  });

  if (entryError) return { error: entryError.message };

  const { error: linesError } = await supabase.from("journal_lines").insert([
    {
      journal_entry_id: entryId,
      account_id: asset.depreciation_expense_account_id,
      debit: amount,
      credit: 0,
    },
    {
      journal_entry_id: entryId,
      account_id: asset.accumulated_depreciation_account_id,
      debit: 0,
      credit: amount,
    },
  ]);

  if (linesError) {
    await supabase.from("journal_entries").delete().eq("id", entryId);
    return { error: linesError.message };
  }

  const { error: postError } = await supabase
    .from("journal_entries")
    .update({ status: "posted" })
    .eq("id", entryId);

  if (postError) {
    await supabase.from("journal_entries").delete().eq("id", entryId);
    return { error: postError.message };
  }

  await supabase
    .from("fixed_assets")
    .update({
      accumulated_months: asset.accumulated_months + 1,
      next_depreciation_date: advanceOneMonth(asset.next_depreciation_date),
    })
    .eq("id", assetId);

  return { id: entryId };
}
