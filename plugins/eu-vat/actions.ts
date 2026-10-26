// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

"use server";

import { createClient } from "@/lib/supabase/server";
import { canWrite, getCurrentUserRole } from "@/lib/org/current";
import { getPluginData, setPluginData } from "@/lib/plugins/data";
import { getOrgEnabledPluginIds } from "@/lib/plugins/settings";
import { EU_STANDARD_RATES, isVatNumberShape } from "./rates";
import { vatSummary, type SummaryInvoice, type VatSummary } from "./summary";

const PLUGIN = "eu-vat";

export interface VatSettings {
  country: string;
  vatNumber: string;
  // Liability: VAT charged on sales. Asset: VAT paid on purchases, to reclaim.
  outputAccountId: string;
  inputAccountId: string;
}

// Customers that are VAT-registered businesses in another EU country:
// their invoices carry no VAT, and the customer accounts for it.
export type ReverseChargeCustomers = Record<string, { vatNumber: string }>;

export interface VatSetup {
  settings: VatSettings;
  reverseCharge: ReverseChargeCustomers;
  customers: { id: string; name: string }[];
  accounts: { id: string; account_number: string; name: string; type: string }[];
  rates: { id: string; name: string; rate: number; is_active: boolean }[];
}

type Result<T = null> = { ok: true; value: T } | { ok: false; error: string };
const fail = (err: unknown): { ok: false; error: string } => ({ ok: false, error: err instanceof Error ? err.message : String(err) });

// Every action: the plugin is on for the book (acknowledged by the instance
// and the book), and the caller may read, or write.
async function open(orgId: string, write: boolean) {
  const supabase = await createClient();
  if (!(await getOrgEnabledPluginIds(supabase, orgId)).includes(PLUGIN)) {
    throw new Error("EU VAT isn't turned on for this book. An owner turns it on in Settings, after acknowledging its disclaimer.");
  }
  const role = await getCurrentUserRole(orgId);
  if (!role || (write && !canWrite(role))) throw new Error("You can't change VAT settings in this book.");
  return supabase;
}

const EMPTY: VatSettings = { country: "", vatNumber: "", outputAccountId: "", inputAccountId: "" };

export async function getVatSetup(orgId: string): Promise<Result<VatSetup>> {
  try {
    const supabase = await open(orgId, false);
    const [settings, reverseCharge, { data: customers }, { data: accounts }, { data: rates }] = await Promise.all([
      getPluginData<VatSettings>(supabase, orgId, PLUGIN, "settings"),
      getPluginData<ReverseChargeCustomers>(supabase, orgId, PLUGIN, "reverse-charge"),
      supabase.from("customers").select("id, name").eq("organization_id", orgId).eq("is_active", true).order("name"),
      supabase
        .from("accounts")
        .select("id, account_number, name, type")
        .eq("organization_id", orgId)
        .eq("is_active", true)
        .is("currency", null)
        .in("type", ["asset", "liability"])
        .order("account_number"),
      supabase.from("sales_tax_rates").select("id, name, rate, is_active").eq("organization_id", orgId).order("name"),
    ]);
    return {
      ok: true,
      value: {
        settings: settings ?? EMPTY,
        reverseCharge: reverseCharge ?? {},
        customers: (customers ?? []) as VatSetup["customers"],
        accounts: (accounts ?? []) as VatSetup["accounts"],
        rates: (rates ?? []) as VatSetup["rates"],
      },
    };
  } catch (err) {
    return fail(err);
  }
}

export async function saveVatSetup(orgId: string, settings: VatSettings, reverseCharge: ReverseChargeCustomers): Promise<Result> {
  try {
    const supabase = await open(orgId, true);
    if (settings.country && !EU_STANDARD_RATES[settings.country]) throw new Error("Choose an EU country");
    if (settings.vatNumber && !isVatNumberShape(settings.vatNumber)) throw new Error("That doesn't look like an EU VAT number");
    for (const [, c] of Object.entries(reverseCharge)) {
      if (!isVatNumberShape(c.vatNumber)) throw new Error(`${c.vatNumber || "A blank"} isn't an EU VAT number`);
    }
    await Promise.all([
      setPluginData(supabase, orgId, PLUGIN, "settings", settings),
      setPluginData(supabase, orgId, PLUGIN, "reverse-charge", reverseCharge),
    ]);
    return { ok: true, value: null };
  } catch (err) {
    return fail(err);
  }
}

// A VAT rate is a named sales tax rate (Settings -> Sales tax) whose
// credit goes to the output VAT account; invoices pick it like any other.
export async function addVatRate(orgId: string, name: string, rate: number): Promise<Result> {
  try {
    const supabase = await open(orgId, true);
    const settings = await getPluginData<VatSettings>(supabase, orgId, PLUGIN, "settings");
    if (!settings?.outputAccountId) throw new Error("Choose the output VAT account first");
    if (!(rate > 0 && rate < 100) || !name.trim()) throw new Error("A name and a rate between 0 and 100 are needed");
    const { error } = await supabase
      .from("sales_tax_rates")
      .insert({ organization_id: orgId, name: name.trim(), rate, account_id: settings.outputAccountId });
    if (error) throw new Error(error.code === "23505" ? "There's already a rate with that name" : error.message);
    return { ok: true, value: null };
  } catch (err) {
    return fail(err);
  }
}

interface RawInvoice {
  id: string;
  customer_id: string;
  tax_rate: number;
  tax_amount: number;
  invoice_lines: { amount: number }[];
  invoice_taxes: { name: string; rate: number; amount: number }[];
}

export async function getVatSummary(orgId: string, start: string, end: string): Promise<Result<VatSummary>> {
  try {
    const supabase = await open(orgId, false);
    const [settings, reverseCharge, { data: invoices, error }] = await Promise.all([
      getPluginData<VatSettings>(supabase, orgId, PLUGIN, "settings"),
      getPluginData<ReverseChargeCustomers>(supabase, orgId, PLUGIN, "reverse-charge"),
      supabase
        .from("invoices")
        .select("id, customer_id, tax_rate, tax_amount, invoice_lines(amount), invoice_taxes(name, rate, amount)")
        .eq("organization_id", orgId)
        .neq("status", "void")
        .gte("invoice_date", start)
        .lte("invoice_date", end),
    ]);
    if (error) throw new Error(error.message);

    let inputVat = 0;
    if (settings?.inputAccountId) {
      const { data: lines, error: ledgerError } = await supabase.rpc("get_account_ledger", {
        p_org_id: orgId,
        p_account_id: settings.inputAccountId,
        p_start_date: start,
        p_end_date: end,
      });
      if (ledgerError) throw new Error(ledgerError.message);
      inputVat = ((lines ?? []) as { debit: number; credit: number }[]).reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);
    }

    const rows: SummaryInvoice[] = ((invoices ?? []) as RawInvoice[]).map((i) => ({
      id: i.id,
      customer_id: i.customer_id,
      subtotal: i.invoice_lines.reduce((s, l) => s + Number(l.amount), 0),
      // A single rate typed on the invoice has no named rows.
      taxes:
        i.invoice_taxes.length > 0 || !(Number(i.tax_amount) > 0)
          ? i.invoice_taxes
          : [{ name: `${Number(i.tax_rate)}%`, rate: Number(i.tax_rate), amount: Number(i.tax_amount) }],
    }));
    return { ok: true, value: vatSummary(rows, new Set(Object.keys(reverseCharge ?? {})), inputVat) };
  } catch (err) {
    return fail(err);
  }
}
