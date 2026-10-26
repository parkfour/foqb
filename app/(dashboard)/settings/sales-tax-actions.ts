"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canWrite, getCurrentUserRole } from "@/lib/org/current";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { salesTaxLookups } from "@/lib/plugins/server-loader";
import type { SalesTaxAddress } from "@/lib/plugins/types";

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

export interface LookedUpRate {
  source: string;
  name: string;
  rate: number;
}

// Rates for an address from the book's sales tax plugins (a TaxJar-style
// service), to add with addSalesTaxRate. Writers only; providers often
// charge per lookup, hence the limit.
export async function lookupSalesTaxRates(
  organizationId: string,
  address: SalesTaxAddress,
): Promise<{ rates: LookedUpRate[] } | { error: string }> {
  if (!canWrite(await getCurrentUserRole(organizationId))) return { error: "You can't change sales tax rates in this book." };
  if (!address.zip?.trim() || !address.country?.trim()) return { error: "Enter at least a postal code and a country." };
  if (!(await checkRateLimit("sales-tax-lookup", organizationId, 30, 3600))) return { error: "Too many lookups this hour; try again later." };
  const clean = Object.fromEntries(Object.entries(address).map(([k, v]) => [k, String(v ?? "").trim().slice(0, 100)])) as unknown as SalesTaxAddress;
  const rates: LookedUpRate[] = [];
  const errors: string[] = [];
  for (const lookup of await salesTaxLookups(createAdminClient(), organizationId)) {
    try {
      for (const r of await lookup.rates(clean)) {
        if (r.name && r.rate > 0 && r.rate < 100) rates.push({ source: lookup.name, name: r.name.slice(0, 100), rate: r.rate });
      }
    } catch (err) {
      errors.push(`${lookup.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return rates.length || !errors.length ? { rates } : { error: errors.join("; ") };
}
