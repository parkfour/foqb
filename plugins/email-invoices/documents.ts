// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canWrite, getCurrentOrgId, getCurrentUserRole } from "@/lib/org/current";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { bookCanSendMail, sendBookMail } from "@/lib/plugins/server-loader";
import { getOrgEnabledPluginIds } from "@/lib/plugins/settings";
import { buildStatement, fetchStatementInvoices } from "@/lib/ar/statement";
import { estimateSubtotal } from "@/lib/ar/estimates";
import { formatMoney } from "@/lib/money";
import { getBookCurrency } from "@/lib/org/book-currency";
import { isEmailAddress } from "./mailer";

// Estimates and statements by email, as plain text, through the book's
// mailer (sendBookMail): this plugin's mail server.

const SEND_LIMIT = 50;
type Result = { ok: true; message: string } | { error: string };

export interface DocumentMailStatus {
  canSend: boolean;
  configured: boolean;
}

export async function getDocumentMailStatus(): Promise<DocumentMailStatus> {
  const orgId = await getCurrentOrgId();
  if (!orgId || !canWrite(await getCurrentUserRole(orgId))) return { canSend: false, configured: false };
  return { canSend: true, configured: await bookCanSendMail(createAdminClient(), orgId) };
}

// The caller writes in the book, the plugin is on in it, and the hour's
// limit isn't spent. Returns the book, or why not.
async function sender(to: string, message: string): Promise<{ orgId: string } | { error: string }> {
  if (!isEmailAddress(to)) return { error: "Enter the recipient's email address." };
  if (message.length > 10_000) return { error: "The message is too long." };
  const orgId = await getCurrentOrgId();
  if (!orgId || !canWrite(await getCurrentUserRole(orgId))) return { error: "You can't send mail from this book." };
  if (!(await getOrgEnabledPluginIds(await createClient(), orgId)).includes("email-invoices")) {
    return { error: "Email invoices isn't on in this book." };
  }
  if (!(await checkRateLimit("invoice-email", orgId, SEND_LIMIT, 3600))) {
    return { error: "This book has sent too many emails this hour; try again later." };
  }
  return { orgId };
}

async function send(orgId: string, to: string, subject: string, text: string): Promise<Result> {
  try {
    const sent = await sendBookMail(createAdminClient(), orgId, { to, subject, text });
    return sent.sent ? { ok: true, message: `Sent to ${to}.` } : { error: sent.reason };
  } catch (err) {
    return { error: `Couldn't send: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export async function sendEstimateEmail(estimateId: string, to: string, message: string): Promise<Result> {
  const who = await sender(to, message);
  if ("error" in who) return who;
  const supabase = await createClient();
  const { data } = await supabase
    .from("estimates")
    .select("estimate_number, estimate_date, expiry_date, estimate_lines(description, quantity, unit_price)")
    .eq("id", estimateId)
    .eq("organization_id", who.orgId)
    .maybeSingle();
  const e = data as {
    estimate_number: string;
    estimate_date: string;
    expiry_date: string | null;
    estimate_lines: { description: string | null; quantity: number; unit_price: number }[];
  } | null;
  if (!e) return { error: "Estimate not found." };
  const currency = await getBookCurrency(who.orgId);
  const money = (n: number) => formatMoney(n, currency);
  const text = [
    message.trim(),
    "",
    `Estimate ${e.estimate_number}, dated ${e.estimate_date}${e.expiry_date ? `, good until ${e.expiry_date}` : ""}:`,
    ...e.estimate_lines.map((l) => `  ${l.description || "Item"}: ${Number(l.quantity)} × ${money(Number(l.unit_price))}`),
    `Before tax: ${money(estimateSubtotal(e.estimate_lines))}`,
  ].join("\n");
  return send(who.orgId, to, `Estimate ${e.estimate_number}`, text);
}

export async function sendStatementEmail(customerId: string, start: string, end: string, to: string, message: string): Promise<Result> {
  const who = await sender(to, message);
  if ("error" in who) return who;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return { error: "Choose the statement's dates." };
  const supabase = await createClient();
  const statement = buildStatement(await fetchStatementInvoices(supabase, who.orgId, customerId), start, end);
  const currency = await getBookCurrency(who.orgId);
  const money = (n: number) => formatMoney(n, currency);
  const text = [
    message.trim(),
    "",
    `Statement, ${start} to ${end}`,
    `  ${start}  Balance forward  ${money(statement.opening)}`,
    ...statement.lines.map((l) => `  ${l.date}  ${l.label}  ${money(l.amount)}  (balance ${money(l.balance)})`),
    `Amount due: ${money(statement.closing)}`,
  ].join("\n");
  return send(who.orgId, to, `Statement, ${start} to ${end}`, text);
}
