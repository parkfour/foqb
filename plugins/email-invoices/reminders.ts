// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptToken } from "@/lib/crypto/token-encryption";
import { getOrgEnabledPluginIds, getPluginSettings } from "@/lib/plugins/settings";
import { instanceTimezone } from "@/lib/org/book-clock";
import { addDays, localDate } from "@/lib/time/book-time";
import { formatMoney } from "@/lib/money";
import { isEmailAddress, sendMail, type MailServer } from "./mailer";

export const REMINDER_INTERVAL_SECONDS = 6 * 60 * 60;
// Per book, per run: a backlog goes out over several runs.
const MAX_PER_RUN = 25;

export interface OverdueInvoice {
  id: string;
  invoice_number: string;
  due_date: string;
  owed: number;
  customer: string;
  email: string;
}

export function reminderText(org: string, inv: OverdueInvoice, currency: string): { subject: string; text: string } {
  return {
    subject: `Reminder: invoice ${inv.invoice_number} from ${org} is past due`,
    text: [
      `Hello ${inv.customer},`,
      "",
      `This is a reminder that invoice ${inv.invoice_number}, due ${inv.due_date}, still has ${formatMoney(inv.owed, currency)} to pay.`,
      "If you've already paid, thank you, and please ignore this message.",
      "",
      org,
    ].join("\n"),
  };
}

interface RawInvoice {
  id: string;
  invoice_number: string;
  due_date: string;
  tax_amount: number;
  customers: { name: string; email: string | null } | null;
  invoice_lines: { amount: number }[];
  invoice_payments: { amount: number }[];
  invoice_emails: { kind: string }[];
}

// Invoices this many days or more past due, still owing, to a customer
// with an email address, not yet reminded.
export async function findOverdue(admin: SupabaseClient, orgId: string, cutoff: string): Promise<OverdueInvoice[]> {
  const { data, error } = await admin
    .from("invoices")
    .select("id, invoice_number, due_date, tax_amount, customers(name, email), invoice_lines(amount), invoice_payments(amount), invoice_emails(kind)")
    .eq("organization_id", orgId)
    .in("status", ["open", "partial"])
    .lte("due_date", cutoff)
    .order("due_date");
  if (error) throw error;
  return ((data ?? []) as unknown as RawInvoice[])
    .filter((i) => !i.invoice_emails.some((e) => e.kind === "reminder") && i.customers?.email && isEmailAddress(i.customers.email))
    .map((i) => ({
      id: i.id,
      invoice_number: i.invoice_number,
      due_date: i.due_date,
      customer: i.customers!.name,
      email: i.customers!.email!,
      owed:
        Math.round(
          (i.invoice_lines.reduce((s, l) => s + Number(l.amount), 0) + Number(i.tax_amount) - i.invoice_payments.reduce((s, p) => s + Number(p.amount), 0)) * 100,
        ) / 100,
    }))
    .filter((i) => i.owed > 0);
}

// The plugin's job: for each book with a mail server, the plugin on and
// reminders turned on, one email per overdue invoice.
export async function sendDueReminders(): Promise<{ sent: number; failed: number }> {
  const admin = createAdminClient();
  let sent = 0;
  let failed = 0;
  const { data: servers, error } = await admin
    .from("organization_smtp_settings")
    .select("organization_id, host, port, username, password_encrypted, from_address, reply_to, organizations!inner(name, timezone, currency, suspended_at)")
    .is("organizations.suspended_at", null);
  if (error) throw error;

  for (const row of (servers ?? []) as unknown as {
    organization_id: string;
    host: string;
    port: number;
    username: string;
    password_encrypted: string;
    from_address: string;
    reply_to: string | null;
    organizations: { name: string; timezone: string | null; currency: string | null };
  }[]) {
    const orgId = row.organization_id;
    try {
      if (!(await getOrgEnabledPluginIds(admin, orgId)).includes("email-invoices")) continue;
      const days = Number((await getPluginSettings<{ reminderDays?: number }>(admin, orgId, "email-invoices")).reminderDays) || 0;
      if (days <= 0) continue;

      const today = localDate(row.organizations.timezone ?? instanceTimezone());
      const overdue = (await findOverdue(admin, orgId, addDays(today, -days))).slice(0, MAX_PER_RUN);
      const server: MailServer = {
        host: row.host,
        port: row.port,
        username: row.username,
        password: decryptToken(row.password_encrypted),
        fromAddress: row.from_address,
        replyTo: row.reply_to,
      };
      for (const inv of overdue) {
        const { subject, text } = reminderText(row.organizations.name, inv, row.organizations.currency ?? "USD");
        try {
          await sendMail(server, { fromName: row.organizations.name, to: inv.email, subject, text });
          await admin.from("invoice_emails").insert({ organization_id: orgId, invoice_id: inv.id, sent_to: inv.email, subject, kind: "reminder", sent_by: null });
          sent++;
        } catch (err) {
          failed++;
          console.error(`Invoice reminder for ${inv.id} failed`, err);
        }
      }
    } catch (err) {
      failed++;
      console.error(`Invoice reminders for book ${orgId} failed`, err);
    }
  }
  return { sent, failed };
}
