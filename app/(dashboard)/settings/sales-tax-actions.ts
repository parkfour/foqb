"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function back(error?: string): never {
  revalidatePath("/settings");
  redirect(error ? `/settings?error=${encodeURIComponent(error)}#sales-tax` : "/settings#sales-tax");
}

export async function addSalesTaxRate(formData: FormData): Promise<void> {
  const organizationId = formData.get("organizationId") as string;
  const name = ((formData.get("name") as string) ?? "").trim();
  const rate = Number(formData.get("rate"));
  const accountId = (formData.get("accountId") as string) || null;
  if (!organizationId || !name) back("A sales tax rate needs a name");
  if (!(rate > 0 && rate < 100)) back("A sales tax rate is a percentage above 0 and below 100");

  const supabase = await createClient();
  const { error } = await supabase
    .from("sales_tax_rates")
    .insert({ organization_id: organizationId, name: name.slice(0, 100), rate, account_id: accountId });
  if (error) back(error.code === "23505" ? `There's already a rate named ${name}` : "Couldn't add the rate");
  back();
}

// Rates are retired rather than deleted: invoices that charged one still
// point at it.
export async function setSalesTaxRateActive(formData: FormData): Promise<void> {
  const id = formData.get("id") as string;
  const active = formData.get("active") === "true";
  const supabase = await createClient();
  const { error } = await supabase.from("sales_tax_rates").update({ is_active: active }).eq("id", id);
  if (error) back("Couldn't change the rate");
  back();
}
