// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { createSupabaseMock, ok } from "./supabase-mock";
import { startSmtpSink } from "./smtp-sink";

const { state } = vi.hoisted(() => ({
  state: {
    role: "owner" as string | null,
    enabledIds: ["email-invoices"],
    smtp: null as Record<string, unknown> | null,
  },
}));

vi.mock("@/lib/org/current", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/org/current")>()),
  getCurrentOrgId: async () => "org-1",
  getCurrentUserRole: async () => state.role,
}));
vi.mock("@/lib/plugins/settings", () => ({ getOrgEnabledPluginIds: async () => state.enabledIds }));
vi.mock("@/lib/auth/rate-limit", () => ({ checkRateLimit: async () => true }));
vi.mock("@/lib/org/book-currency", () => ({ getBookCurrency: async () => "USD" }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () =>
    createSupabaseMock({
      tables: {
        organization_smtp_settings: { select: ok(state.smtp) },
        organizations: { select: ok({ name: "Test Shop LLC" }) },
      },
    }).client,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () =>
    createSupabaseMock({
      tables: {
        invoices: {
          select: ok([
            { id: "i1", invoice_number: "INV-1", invoice_date: "2026-10-05", due_date: null, tax_amount: 0, invoice_lines: [{ amount: 40 }], invoice_payments: [] },
            {
              id: "i2",
              invoice_number: "INV-2",
              invoice_date: "2026-10-06",
              due_date: null,
              tax_amount: 0,
              invoice_lines: [{ amount: 20 }],
              invoice_payments: [{ payment_date: "2026-10-07", amount: 5, credit_memos: { memo_number: "CM-1" } }],
            },
          ]),
        },
        estimates: {
          select: ok({
            estimate_number: "EST-1",
            estimate_date: "2026-10-10",
            expiry_date: "2026-11-10",
            estimate_lines: [{ description: "Widget", quantity: 2, unit_price: 10 }],
          }),
        },
      },
    }).client,
}));

import { sendMail } from "@/plugins/email-invoices/mailer";
import { sendEstimateEmail, sendStatementEmail } from "@/plugins/email-invoices/documents";
import { encryptToken } from "@/lib/crypto/token-encryption";

const env = { ...process.env };
let sink: Awaited<ReturnType<typeof startSmtpSink>>;

beforeAll(async () => {
  // A local server with a self-signed certificate.
  process.env.ALLOW_PRIVATE_NETWORK_HOSTS = "true";
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
  sink = await startSmtpSink();
});

afterAll(async () => {
  await sink.close();
  process.env = env;
});

beforeEach(() => {
  state.role = "owner";
  state.enabledIds = ["email-invoices"];
  state.smtp = {
    host: "localhost",
    port: sink.port,
    username: "mailer",
    password_encrypted: encryptToken("s3cret"),
    from_address: "books@shop.example",
    reply_to: null,
  };
});

afterEach(() => {
  sink.received.length = 0;
});

describe("sendMail", () => {
  it("logs in over STARTTLS and delivers the message and its PDF", async () => {
    await sendMail(
      { host: "localhost", port: sink.port, username: "u", password: "p", fromAddress: "books@shop.example", replyTo: "owner@shop.example" },
      {
        fromName: "Test Shop LLC",
        to: "ann@example.test",
        subject: "Invoice INV-1",
        text: "Attached.",
        attachment: { filename: "Invoice-INV-1.pdf", content: Buffer.from("%PDF-1.4 test") },
      },
    );

    const [mail] = sink.received;
    expect(mail).toMatchObject({ from: "books@shop.example", to: ["ann@example.test"], user: "u", password: "p", secure: true });
    expect(mail.raw).toMatch(/^From: "?Test Shop LLC"? <books@shop\.example>/m);
    expect(mail.raw).toMatch(/^Reply-To: owner@shop\.example/m);
    expect(mail.raw).toMatch(/^Subject: Invoice INV-1/m);
    expect(mail.text).toContain("Attached.");
    expect(mail.raw).toMatch(/Content-Type: application\/pdf; name=Invoice-INV-1\.pdf/);
  });

  it("can't be made to add headers or recipients through a line break in the subject or name", async () => {
    await sendMail(
      { host: "localhost", port: sink.port, username: "u", password: "p", fromAddress: "books@shop.example", replyTo: null },
      { fromName: "Shop\r\nBcc: evil@example.com", to: "ann@example.test", subject: "Estimate EST-1\r\nBcc: evil@example.com", text: "x" },
    );
    const [mail] = sink.received;
    expect(mail.to).toEqual(["ann@example.test"]);
    expect(mail.raw).not.toMatch(/^Bcc:/im);
    expect(mail.raw).toMatch(/^Subject: Estimate EST-1 Bcc: evil@example\.com$/m);
  });

  it("refuses a server that won't encrypt, before sending the password", async () => {
    const plain = await startSmtpSink({ noStartTls: true });
    try {
      await expect(
        sendMail(
          { host: "localhost", port: plain.port, username: "u", password: "p", fromAddress: "books@shop.example", replyTo: null },
          { fromName: "Shop", to: "ann@example.test", subject: "Hi", text: "Hello" },
        ),
      ).rejects.toThrow();
      expect(plain.received).toEqual([]);
    } finally {
      await plain.close();
    }
  });
});

describe("emailing statements and estimates through the book's mailer", () => {
  it("sends a statement with its figures, through the book's own server and login", async () => {
    const result = await sendStatementEmail("cust-1", "2026-10-01", "2026-10-31", "ann@example.test", "Hello Ann,");

    expect(result).toEqual({ ok: true, message: "Sent to ann@example.test." });
    const [mail] = sink.received;
    expect(mail).toMatchObject({ to: ["ann@example.test"], user: "mailer", password: "s3cret" });
    expect(mail.raw).toMatch(/^Subject: Statement, 2026-10-01 to 2026-10-31/m);
    expect(mail.raw).toMatch(/^From: "?Test Shop LLC"? <books@shop\.example>/m);
    expect(mail.text).toContain("Hello Ann,");
    expect(mail.text).toContain("Credit memo CM-1, invoice INV-2");
    expect(mail.text).toContain("Amount due: $55.00");
  });

  it("sends an estimate with its lines", async () => {
    expect(await sendEstimateEmail("est-1", "ann@example.test", "Here you go.")).toEqual({ ok: true, message: "Sent to ann@example.test." });
    const [mail] = sink.received;
    expect(mail.raw).toMatch(/^Subject: Estimate EST-1/m);
    expect(mail.text).toContain("good until 2026-11-10");
    expect(mail.text).toContain("Widget: 2 × $10.00");
    expect(mail.text).toContain("Before tax: $20.00");
  });

  it("sends nothing for a viewer, a book without the plugin, a bad address, or no mail server", async () => {
    state.role = "viewer";
    expect(await sendStatementEmail("cust-1", "2026-10-01", "2026-10-31", "ann@example.test", "")).toEqual({ error: "You can't send mail from this book." });

    state.role = "owner";
    expect(await sendStatementEmail("cust-1", "2026-10-01", "2026-10-31", "not an address", "")).toMatchObject({ error: expect.stringMatching(/address/) });

    state.enabledIds = [];
    expect(await sendEstimateEmail("est-1", "ann@example.test", "")).toEqual({ error: "Email invoices isn't on in this book." });

    state.enabledIds = ["email-invoices"];
    state.smtp = null;
    expect(await sendEstimateEmail("est-1", "ann@example.test", "")).toMatchObject({ error: expect.stringMatching(/no way to send mail/) });

    expect(sink.received).toEqual([]);
  });
});
