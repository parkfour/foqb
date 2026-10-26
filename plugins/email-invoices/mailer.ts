// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import nodemailer from "nodemailer";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolvePublicAddress } from "@/lib/net/public-address";
import { decryptToken } from "@/lib/crypto/token-encryption";

// Server-only: imported by the plugin's server actions, never by the
// browser.

export interface MailServer {
  host: string;
  port: number;
  username: string;
  password: string;
  fromAddress: string;
  replyTo: string | null;
}

export interface OutgoingMail {
  fromName: string;
  to: string;
  subject: string;
  text: string;
  attachment?: { filename: string; content: Buffer; contentType?: string };
}

const TIMEOUT_MS = 15_000;

// The book's server with its password, read with the service-role key
// (signed-in users can't read the password). Callers check who's asking.
export async function loadMailServer(admin: SupabaseClient, organizationId: string): Promise<MailServer | null> {
  const { data } = await admin
    .from("organization_smtp_settings")
    .select("host, port, username, password_encrypted, from_address, reply_to")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!data) return null;
  return {
    host: data.host as string,
    port: data.port as number,
    username: data.username as string,
    password: decryptToken(data.password_encrypted as string),
    fromAddress: data.from_address as string,
    replyTo: (data.reply_to as string | null) ?? null,
  };
}

// Simple on purpose: catches typos and header tricks (no spaces, commas or
// line breaks); the mail server is the real judge.
export function isEmailAddress(value: string): boolean {
  return value.length <= 320 && /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/.test(value);
}

// Sends through the organization's own server. Port 465 is TLS from the
// start; any other port must upgrade with STARTTLS, so the password never
// crosses the network in the clear.
export async function sendMail(server: MailServer, mail: OutgoingMail): Promise<void> {
  const address = await resolvePublicAddress(server.host);
  const transport = nodemailer.createTransport({
    host: address,
    port: server.port,
    secure: server.port === 465,
    requireTLS: server.port !== 465,
    // The certificate is checked against the name, not the address.
    tls: { servername: server.host },
    auth: { user: server.username, pass: server.password },
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
  });

  try {
    await transport.sendMail({
      from: { name: mail.fromName, address: server.fromAddress },
      replyTo: server.replyTo ?? undefined,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      attachments: mail.attachment
        ? [{ filename: mail.attachment.filename, content: mail.attachment.content, contentType: mail.attachment.contentType ?? "application/pdf" }]
        : undefined,
    });
  } finally {
    transport.close();
  }
}
