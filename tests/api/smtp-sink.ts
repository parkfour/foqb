// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { SMTPServer } from "smtp-server";
import type { AddressInfo } from "node:net";

export interface Received {
  from: string;
  to: string[];
  user: string;
  password: string;
  secure: boolean;
  raw: string;
  // raw with quoted-printable undone, to search for non-ASCII text.
  text: string;
}

const unQuotedPrintable = (raw: string) =>
  Buffer.from(
    raw.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))),
    "latin1",
  ).toString("utf8");

// A real SMTP server on 127.0.0.1 for a test: it takes any login, offers
// STARTTLS with smtp-server's own self-signed certificate (unless
// noStartTls), and keeps every message. The mailer under test must be told
// to accept that certificate (NODE_TLS_REJECT_UNAUTHORIZED=0) and to allow
// a local address (ALLOW_PRIVATE_NETWORK_HOSTS=true).
export async function startSmtpSink({ noStartTls = false } = {}) {
  const received: Received[] = [];
  const server = new SMTPServer({
    hideSTARTTLS: noStartTls,
    authOptional: false,
    disabledCommands: noStartTls ? ["STARTTLS"] : [],
    // Login over plain text only after STARTTLS, as a real server insists.
    allowInsecureAuth: noStartTls,
    logger: false,
    onAuth(auth, _session, callback) {
      callback(null, { user: `${auth.username}:${auth.password}` });
    },
    onData(stream, session, callback) {
      const chunks: Buffer[] = [];
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("end", () => {
        const [user, password] = String(session.user).split(":");
        const raw = Buffer.concat(chunks).toString("utf8");
        received.push({
          from: session.envelope.mailFrom ? session.envelope.mailFrom.address : "",
          to: session.envelope.rcptTo.map((r) => r.address),
          user,
          password,
          secure: session.secure,
          raw,
          text: unQuotedPrintable(raw),
        });
        callback();
      });
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.server.address() as AddressInfo).port;
  return {
    port,
    received,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
