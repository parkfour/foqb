// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canWrite, getCurrentUserRole } from "@/lib/org/current";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { encryptToken } from "@/lib/crypto/token-encryption";
import { isEmailAddress, loadMailServer as loadBookMailServer, sendMail } from "./mailer";

// Per organization, per hour.
const SEND_LIMIT = 50;
const TEST_LIMIT = 5;
// Under the server-action body limit set in next.config.ts.
const MAX_PDF_BYTES = 3.5 * 1024 * 1024;

export type ActionResult = { error: string } | { ok: true; message?: string };

export interface MailServerSettings {
  host: string;
  port: number;
  username: string;
  fromAddress: string;
  replyTo: string | null;
}

export interface MailSetup {
  isOwner: boolean;
  server: MailServerSettings | null;
}

export interface InvoiceEmailStatus {
  canSend: boolean;
  configured: boolean;
  lastSent: { to: string; at: string } | null;
}

function failure(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.slice(0, 300);
}

// What the Settings section shows. The password never leaves the server.
export async function getMailSetup(organizationId: string): Promise<MailSetup> {
  const role = await getCurrentUserRole(organizationId);
  if (!role) return { isOwner: false, server: null };

  const supabase = await createClient();
  const { data } = await supabase
    .from("organization_smtp_settings")
    .select("host, port, username, from_address, reply_to")
    .eq("organization_id", organizationId)
    .maybeSingle();

  return {
    isOwner: role === "owner",
    server: data
      ? {
          host: data.host as string,
          port: data.port as number,
          username: data.username as string,
          fromAddress: data.from_address as string,
          replyTo: (data.reply_to as string | null) ?? null,
        }
      : null,
  };
}

export async function saveMailServer(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const organizationId = String(formData.get("organizationId") ?? "");
  const host = String(formData.get("host") ?? "").trim().toLowerCase();
  const port = Number(formData.get("port"));
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const fromAddress = String(formData.get("fromAddress") ?? "").trim();
  const replyTo = String(formData.get("replyTo") ?? "").trim() || null;

  if ((await getCurrentUserRole(organizationId)) !== "owner") return { error: "Only an owner can set up email." };
  if (!/^[a-z0-9.-]{1,253}$/.test(host)) return { error: "Enter the mail server's host name." };
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { error: "Enter a port, such as 587 or 465." };
  if (!username || username.length > 320) return { error: "Enter the mail server user name." };
  if (!isEmailAddress(fromAddress)) return { error: "Enter the address mail is sent from." };
  if (replyTo && !isEmailAddress(replyTo)) return { error: "Enter a valid reply-to address, or leave it blank." };

  const supabase = await createClient();
  const fields = {
    host,
    port,
    username,
    from_address: fromAddress,
    reply_to: replyTo,
    updated_at: new Date().toISOString(),
    // Blank keeps the saved password.
    ...(password ? { password_encrypted: encryptToken(password) } : {}),
  };

  const { data: updated, error: updateError } = await supabase
    .from("organization_smtp_settings")
    .update(fields)
    .eq("organization_id", organizationId)
    .select("organization_id");
  if (updateError) return { error: updateError.message };

  if (!updated || updated.length === 0) {
    if (!password) return { error: "Enter the mail server password." };
    const { error } = await supabase
      .from("organization_smtp_settings")
      .insert({ organization_id: organizationId, ...fields });
    if (error) return { error: error.message };
  }

  return { ok: true, message: "Saved." };
}

export async function removeMailServer(organizationId: string): Promise<ActionResult> {
  if ((await getCurrentUserRole(organizationId)) !== "owner") return { error: "Only an owner can change email." };
  const supabase = await createClient();
  const { error } = await supabase.from("organization_smtp_settings").delete().eq("organization_id", organizationId);
  return error ? { error: error.message } : { ok: true, message: "Removed." };
}

// Callers check the user's role first.
const loadMailServer = (organizationId: string) => loadBookMailServer(createAdminClient(), organizationId);

async function organizationName(organizationId: string): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase.from("organizations").select("name").eq("id", organizationId).maybeSingle();
  return (data?.name as string | undefined) ?? "FOQB";
}

// Sends a test message to the signed-in owner.
export async function sendTestEmail(organizationId: string): Promise<ActionResult> {
  if ((await getCurrentUserRole(organizationId)) !== "owner") return { error: "Only an owner can test email." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { error: "Your account has no email address." };
  if (!(await checkRateLimit("invoice-email-test", organizationId, TEST_LIMIT, 3600))) {
    return { error: "Too many test messages; try again in an hour." };
  }

  try {
    const server = await loadMailServer(organizationId);
    if (!server) return { error: "Save the mail server first." };
    const name = await organizationName(organizationId);
    await sendMail(server, {
      fromName: name,
      to: user.email,
      subject: `Test message from ${name}`,
      text: "Your mail server is set up: FOQB can email invoices from this organization.",
    });
  } catch (err) {
    return { error: `Couldn't send: ${failure(err)}` };
  }
  return { ok: true, message: `Sent to ${user.email}.` };
}

export async function getInvoiceEmailStatus(invoiceId: string): Promise<InvoiceEmailStatus> {
  const supabase = await createClient();
  const { data: invoice } = await supabase
    .from("invoices")
    .select("organization_id")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!invoice) return { canSend: false, configured: false, lastSent: null };

  const organizationId = invoice.organization_id as string;
  const [role, { data: server }, { data: last }] = await Promise.all([
    getCurrentUserRole(organizationId),
    supabase.from("organization_smtp_settings").select("organization_id").eq("organization_id", organizationId).maybeSingle(),
    supabase
      .from("invoice_emails")
      .select("sent_to, sent_at")
      .eq("invoice_id", invoiceId)
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return {
    canSend: canWrite(role),
    configured: !!server,
    lastSent: last ? { to: last.sent_to as string, at: last.sent_at as string } : null,
  };
}

// The invoice is looked up here, with the user's own access; the browser
// only supplies the recipient, the wording and the PDF it rendered.
export async function sendInvoiceEmail(formData: FormData): Promise<ActionResult> {
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const to = String(formData.get("to") ?? "").trim();
  const subject = String(formData.get("subject") ?? "").trim();
  const message = String(formData.get("message") ?? "");
  const pdf = formData.get("pdf");

  if (!isEmailAddress(to)) return { error: "Enter the recipient's email address." };
  if (!subject || subject.length > 200 || /[\r\n]/.test(subject)) return { error: "Enter a subject (one line)." };
  if (message.length > 10_000) return { error: "The message is too long." };
  if (!(pdf instanceof File) || pdf.size === 0 || pdf.size > MAX_PDF_BYTES) {
    return { error: "The invoice PDF is missing or too large." };
  }
  const content = Buffer.from(await pdf.arrayBuffer());
  if (content.subarray(0, 5).toString("latin1") !== "%PDF-") return { error: "The attachment isn't a PDF." };

  const supabase = await createClient();
  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, organization_id, invoice_number, status")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!invoice) return { error: "Invoice not found." };
  const organizationId = invoice.organization_id as string;
  if (!canWrite(await getCurrentUserRole(organizationId))) return { error: "You can't send invoices in this organization." };
  if (invoice.status === "void") return { error: "This invoice is void." };

  if (!(await checkRateLimit("invoice-email", organizationId, SEND_LIMIT, 3600))) {
    return { error: "This organization has sent too many emails this hour; try again later." };
  }

  try {
    const server = await loadMailServer(organizationId);
    if (!server) return { error: "Email isn't set up for this organization. An owner can set it up in Settings." };
    await sendMail(server, {
      fromName: await organizationName(organizationId),
      to,
      subject,
      text: message,
      attachment: { filename: `Invoice-${invoice.invoice_number as string}.pdf`, content },
    });
  } catch (err) {
    return { error: `Couldn't send: ${failure(err)}` };
  }

  const { error: logError } = await supabase
    .from("invoice_emails")
    .insert({ organization_id: organizationId, invoice_id: invoiceId, sent_to: to, subject });
  if (logError) console.error("Sent an invoice email but couldn't record it", logError);

  return { ok: true, message: `Sent to ${to}.` };
}
