// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

"use server";

import { createClient } from "@/lib/supabase/server";
import { canWrite, getCurrentUserRole } from "@/lib/org/current";
import { getPluginData, setPluginData } from "@/lib/plugins/data";
import { getOrgEnabledPluginIds } from "@/lib/plugins/settings";
import { calculatePaycheck, paycheckLines, type Employee, type EmployerRates, type Paycheck, type PayrollAccounts } from "./calc";
import { form940, form941, w2s, type PaycheckRecord } from "./reports";

const PLUGIN = "payroll";

export interface PayrollSetup {
  employees: Employee[];
  accounts: PayrollAccounts | null;
  employer: EmployerRates;
}

type Result<T = null> = { ok: true; value: T } | { ok: false; error: string };

// Every action: the plugin is on for the book (so acknowledged by the
// instance and the book), and the caller may read, or write.
async function open(orgId: string, write: boolean) {
  const supabase = await createClient();
  if (!(await getOrgEnabledPluginIds(supabase, orgId)).includes(PLUGIN)) {
    throw new Error("Payroll isn't turned on for this book. An owner turns it on in Settings, after acknowledging its disclaimer.");
  }
  const role = await getCurrentUserRole(orgId);
  if (!role || (write && !canWrite(role))) throw new Error("You can't change payroll in this book.");
  return supabase;
}

const fail = (err: unknown): { ok: false; error: string } => ({ ok: false, error: err instanceof Error ? err.message : String(err) });

export async function getPayrollSetup(orgId: string): Promise<Result<PayrollSetup>> {
  try {
    const supabase = await open(orgId, false);
    const [employees, accounts, employer] = await Promise.all([
      getPluginData<Employee[]>(supabase, orgId, PLUGIN, "employees"),
      getPluginData<PayrollAccounts>(supabase, orgId, PLUGIN, "accounts"),
      getPluginData<EmployerRates>(supabase, orgId, PLUGIN, "employer"),
    ]);
    return { ok: true, value: { employees: employees ?? [], accounts, employer: employer ?? { sutaRate: 0, sutaWageBase: 0 } } };
  } catch (err) {
    return fail(err);
  }
}

export async function savePayrollSetup(orgId: string, setup: PayrollSetup): Promise<Result> {
  try {
    const supabase = await open(orgId, true);
    for (const e of setup.employees) {
      if (!e.name.trim() || !(e.payRate >= 0)) throw new Error("Every employee needs a name and a pay rate");
      if (e.ssnLast4 && !/^\d{4}$/.test(e.ssnLast4)) throw new Error("Keep only the last four digits of a Social Security number");
    }
    await Promise.all([
      setPluginData(supabase, orgId, PLUGIN, "employees", setup.employees),
      setup.accounts ? setPluginData(supabase, orgId, PLUGIN, "accounts", setup.accounts) : Promise.resolve(),
      setPluginData(supabase, orgId, PLUGIN, "employer", setup.employer),
    ]);
    return { ok: true, value: null };
  } catch (err) {
    return fail(err);
  }
}

async function paychecksFor(supabase: Awaited<ReturnType<typeof createClient>>, orgId: string, year: number) {
  return (await getPluginData<PaycheckRecord[]>(supabase, orgId, PLUGIN, `paychecks-${year}`)) ?? [];
}

// The checks a run would write, for review before posting.
export async function previewPayroll(orgId: string, payDate: string, gross: Record<string, number>): Promise<Result<(Paycheck & { employeeId: string })[]>> {
  try {
    const supabase = await open(orgId, false);
    const year = Number(payDate.slice(0, 4));
    const [employees, employer, earlier] = await Promise.all([
      getPluginData<Employee[]>(supabase, orgId, PLUGIN, "employees"),
      getPluginData<EmployerRates>(supabase, orgId, PLUGIN, "employer"),
      paychecksFor(supabase, orgId, year),
    ]);
    const checks = (employees ?? [])
      .filter((e) => e.active && (gross[e.id] ?? 0) > 0)
      .map((e) => {
        const ytd = earlier.filter((p) => p.employeeId === e.id && p.payDate < payDate).reduce((s, p) => s + p.gross, 0);
        return { employeeId: e.id, ...calculatePaycheck(e, gross[e.id], { wages: ytd }, year, employer ?? { sutaRate: 0, sutaWageBase: 0 }) };
      });
    return { ok: true, value: checks };
  } catch (err) {
    return fail(err);
  }
}

// Posts each check as its own entry and records it for the reports.
export async function runPayroll(orgId: string, payDate: string, gross: Record<string, number>): Promise<Result<number>> {
  try {
    const supabase = await open(orgId, true);
    const accounts = await getPluginData<PayrollAccounts>(supabase, orgId, PLUGIN, "accounts");
    if (!accounts || Object.values(accounts).some((id) => !id)) throw new Error("Choose every payroll account first");
    const preview = await previewPayroll(orgId, payDate, gross);
    if (!preview.ok) return preview;
    const year = Number(payDate.slice(0, 4));
    const employees = (await getPluginData<Employee[]>(supabase, orgId, PLUGIN, "employees")) ?? [];
    const records = await paychecksFor(supabase, orgId, year);

    for (const check of preview.value) {
      const name = employees.find((e) => e.id === check.employeeId)?.name ?? "employee";
      const { data: entryId, error } = await supabase.rpc("post_journal_entry", {
        p_org_id: orgId,
        p_entry_date: payDate,
        p_memo: `Payroll: ${name}, ${payDate}`,
        p_lines: paycheckLines(check, accounts),
      });
      if (error) throw new Error(error.message);
      records.push({ ...check, id: crypto.randomUUID(), payDate, journalEntryId: entryId as string });
      // Saved after each check, so a failure part-way loses nothing posted.
      await setPluginData(supabase, orgId, PLUGIN, `paychecks-${year}`, records);
    }
    return { ok: true, value: preview.value.length };
  } catch (err) {
    return fail(err);
  }
}

export interface PayrollReports {
  paychecks: PaycheckRecord[];
  quarters: ReturnType<typeof form941>[];
  futa: ReturnType<typeof form940>;
  w2: ReturnType<typeof w2s>;
}

// Checks whose entry was voided in the journal don't count.
export async function getPayrollReports(orgId: string, year: number): Promise<Result<PayrollReports>> {
  try {
    const supabase = await open(orgId, false);
    const all = await paychecksFor(supabase, orgId, year);
    const entryIds = all.map((p) => p.journalEntryId).filter((id): id is string => !!id);
    const { data } = entryIds.length
      ? await supabase.from("journal_entries").select("id").in("id", entryIds).eq("status", "posted")
      : { data: [] };
    const posted = new Set(((data ?? []) as { id: string }[]).map((r) => r.id));
    const paychecks = all.filter((p) => !p.journalEntryId || posted.has(p.journalEntryId));
    return {
      ok: true,
      value: { paychecks, quarters: [1, 2, 3, 4].map((q) => form941(paychecks, year, q)), futa: form940(paychecks, year), w2: w2s(paychecks, year) },
    };
  } catch (err) {
    return fail(err);
  }
}

export interface AccountOption {
  id: string;
  account_number: string;
  name: string;
  type: string;
}

export async function getAccountOptions(orgId: string): Promise<Result<AccountOption[]>> {
  try {
    const supabase = await open(orgId, false);
    const { data, error } = await supabase
      .from("accounts")
      .select("id, account_number, name, type")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .is("currency", null)
      .in("type", ["asset", "liability", "expense"])
      .order("account_number");
    if (error) throw new Error(error.message);
    return { ok: true, value: (data ?? []) as AccountOption[] };
  } catch (err) {
    return fail(err);
  }
}
