import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createInvoice } from "@/lib/ar/create-invoice";
import { createBill } from "@/lib/ar/create-bill";
import { localDate } from "@/lib/time/book-time";
import { instanceTimezone } from "@/lib/org/book-clock";

export type RecurrenceFrequency = "weekly" | "monthly" | "yearly";

// The same posting as a manually created invoice or bill (lib/ar), so the
// balance checks, control accounts and rollback are shared.

export function computeNextDate(current: string, frequency: RecurrenceFrequency): string {
  const date = new Date(`${current}T00:00:00Z`);
  if (frequency === "weekly") date.setUTCDate(date.getUTCDate() + 7);
  else if (frequency === "monthly") date.setUTCMonth(date.getUTCMonth() + 1);
  else date.setUTCFullYear(date.getUTCFullYear() + 1);
  return date.toISOString().slice(0, 10);
}

// Who's generating: a signed-in member pressing "Generate now", or the
// recurring job (service role, no user).
interface Poster {
  supabase: SupabaseClient;
  createdBy: string | null;
}

async function signedInPoster(): Promise<Poster> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, createdBy: user?.id ?? null };
}

type Generated = { id: string } | { error: string };

// Moves the template on to its next date before posting, only if nobody
// else already has, so the job and a "Generate now" press can't both post
// the same date. Puts the date back if posting fails.
async function claimDate(
  supabase: SupabaseClient,
  table: "recurring_invoices" | "recurring_bills",
  id: string,
  current: string,
  frequency: RecurrenceFrequency,
): Promise<boolean> {
  const { data } = await supabase
    .from(table)
    .update({ next_date: computeNextDate(current, frequency) })
    .eq("id", id)
    .eq("next_date", current)
    .select("id");
  return (data ?? []).length > 0;
}

const autoNumber = (date: string) => `AUTO-${date.replace(/-/g, "")}-${randomUUID().slice(0, 4)}`;

export async function generateInvoiceFromTemplate(
  orgId: string,
  recurringInvoiceId: string,
  poster?: Poster,
): Promise<Generated> {
  const { supabase, createdBy } = poster ?? (await signedInPoster());

  const [{ data: template }, { data: lines }] = await Promise.all([
    supabase
      .from("recurring_invoices")
      .select("id, organization_id, customer_id, next_date, tax_rate, frequency")
      .eq("id", recurringInvoiceId)
      .eq("organization_id", orgId)
      .maybeSingle(),
    supabase
      .from("recurring_invoice_lines")
      .select("item_id, account_id, description, quantity, unit_price")
      .eq("recurring_invoice_id", recurringInvoiceId),
  ]);

  if (!template) return { error: "Recurring invoice template not found" };
  const row = template as { organization_id: string; customer_id: string; next_date: string; tax_rate: number; frequency: RecurrenceFrequency };

  if (!(await claimDate(supabase, "recurring_invoices", recurringInvoiceId, row.next_date, row.frequency))) {
    return { error: "This invoice was just generated" };
  }

  const result = await createInvoice(
    supabase,
    {
      organization_id: row.organization_id,
      customer_id: row.customer_id,
      invoice_number: autoNumber(row.next_date),
      invoice_date: row.next_date,
      due_date: null,
      tax_rate: Number(row.tax_rate),
      lines: (lines ?? []) as { item_id: string | null; account_id: string; description: string; quantity: number; unit_price: number }[],
    },
    createdBy,
  );

  if ("error" in result) {
    await supabase.from("recurring_invoices").update({ next_date: row.next_date }).eq("id", recurringInvoiceId);
    return { error: result.error };
  }
  return { id: result.id };
}

export async function generateBillFromTemplate(
  orgId: string,
  recurringBillId: string,
  poster?: Poster,
): Promise<Generated> {
  const { supabase, createdBy } = poster ?? (await signedInPoster());

  const [{ data: template }, { data: lines }] = await Promise.all([
    supabase
      .from("recurring_bills")
      .select("id, organization_id, vendor_id, next_date, frequency")
      .eq("id", recurringBillId)
      .eq("organization_id", orgId)
      .maybeSingle(),
    supabase
      .from("recurring_bill_lines")
      .select("account_id, description, quantity, unit_price")
      .eq("recurring_bill_id", recurringBillId),
  ]);

  if (!template) return { error: "Recurring bill template not found" };
  const row = template as { organization_id: string; vendor_id: string; next_date: string; frequency: RecurrenceFrequency };

  if (!(await claimDate(supabase, "recurring_bills", recurringBillId, row.next_date, row.frequency))) {
    return { error: "This bill was just generated" };
  }

  const result = await createBill(
    supabase,
    {
      organization_id: row.organization_id,
      vendor_id: row.vendor_id,
      bill_number: autoNumber(row.next_date),
      bill_date: row.next_date,
      due_date: null,
      lines: (lines ?? []) as { account_id: string; description: string; quantity: number; unit_price: number }[],
    },
    createdBy,
  );

  if ("error" in result) {
    await supabase.from("recurring_bills").update({ next_date: row.next_date }).eq("id", recurringBillId);
    return { error: result.error };
  }
  return { id: result.id };
}

// Most dates one template catches up in a run (a weekly template a year
// behind is 52); the rest follow on the next run.
const MAX_CATCH_UP = 60;
export const RECURRING_INTERVAL_SECONDS = 60 * 60;

interface DueTemplate {
  id: string;
  organization_id: string;
  next_date: string;
  frequency: RecurrenceFrequency;
  organizations: { timezone: string | null; suspended_at: string | null } | null;
}

// The recurring job: every active template whose next date has come, in
// its book's own time zone, generated until it's in the future. Suspended
// books are left alone.
export async function generateDueRecurring(): Promise<{ generated: number; failed: number }> {
  const supabase = createAdminClient();
  const poster = { supabase, createdBy: null };
  let generated = 0;
  let failed = 0;

  const kinds = [
    { table: "recurring_invoices", generate: generateInvoiceFromTemplate },
    { table: "recurring_bills", generate: generateBillFromTemplate },
  ] as const;

  for (const { table, generate } of kinds) {
    const { data, error } = await supabase
      .from(table)
      .select("id, organization_id, next_date, frequency, organizations!inner(timezone, suspended_at)")
      .eq("is_active", true)
      .is("organizations.suspended_at", null);
    if (error) throw error;

    for (const t of (data ?? []) as unknown as DueTemplate[]) {
      const today = localDate(t.organizations?.timezone ?? instanceTimezone());
      let nextDate = t.next_date;
      for (let i = 0; i < MAX_CATCH_UP && nextDate <= today; i++) {
        const result = await generate(t.organization_id, t.id, poster);
        if ("error" in result) {
          failed++;
          console.error(`Recurring ${table} ${t.id} on ${nextDate} failed: ${result.error}`);
          break;
        }
        generated++;
        nextDate = computeNextDate(nextDate, t.frequency);
      }
    }
  }
  return { generated, failed };
}
