import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, ok } from "./supabase-mock";
import { decryptToken, encryptToken } from "@/lib/crypto/token-encryption";
import { isPublicAddress, resolvePublicAddress } from "@/lib/net/public-address";

const { serverClientMock, adminClientMock, getCurrentUserRoleMock, rateLimitMock, sendMailMock } = vi.hoisted(() => ({
  serverClientMock: vi.fn(),
  adminClientMock: vi.fn(),
  getCurrentUserRoleMock: vi.fn(),
  rateLimitMock: vi.fn(),
  sendMailMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: serverClientMock }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: adminClientMock }));
vi.mock("@/lib/auth/rate-limit", () => ({ checkRateLimit: rateLimitMock }));
vi.mock("@/lib/org/current", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/org/current")>()),
  getCurrentUserRole: getCurrentUserRoleMock,
}));
vi.mock("@/plugins/email-invoices/mailer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/plugins/email-invoices/mailer")>()),
  sendMail: sendMailMock,
}));

import { saveMailServer, sendInvoiceEmail } from "@/plugins/email-invoices/actions";

const pdf = () => new File(["%PDF-1.7 fake"], "Invoice-INV-1.pdf", { type: "application/pdf" });

function sendForm(overrides: Record<string, string | File> = {}): FormData {
  const fd = new FormData();
  const fields = { invoiceId: "inv-1", to: "billing@acme.test", subject: "Invoice INV-1", message: "Hi", pdf: pdf(), ...overrides };
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

function userClient(invoiceStatus = "open") {
  return createSupabaseMock({
    user: { id: "user-1" },
    tables: {
      invoices: { select: ok({ id: "inv-1", organization_id: "org-1", invoice_number: "INV-1", status: invoiceStatus }) },
      organizations: { select: ok({ name: "Acme Consulting" }) },
      invoice_emails: { insert: ok(null) },
    },
  });
}

const userMock = (status?: string) => userClient(status).client;

function adminWithServer() {
  return createSupabaseMock({
    tables: {
      organization_smtp_settings: {
        select: ok({
          host: "smtp.example.com",
          port: 587,
          username: "mailer",
          password_encrypted: encryptToken("s3cret"),
          from_address: "billing@acme-consulting.test",
          reply_to: "owner@acme-consulting.test",
        }),
      },
    },
  }).client;
}

beforeEach(() => {
  vi.clearAllMocks();
  rateLimitMock.mockResolvedValue(true);
  sendMailMock.mockResolvedValue(undefined);
  getCurrentUserRoleMock.mockResolvedValue("accountant");
  adminClientMock.mockReturnValue(adminWithServer());
});

describe("public addresses", () => {
  it("refuses loopback, private, link-local and mapped private addresses", () => {
    for (const address of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "0.0.0.0"]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
  });

  it("accepts public addresses", () => {
    for (const address of ["8.8.8.8", "172.32.0.1", "2606:4700::1111", "::ffff:1.1.1.1"]) {
      expect(isPublicAddress(address), address).toBe(true);
    }
  });

  it("refuses a host name that resolves locally", async () => {
    await expect(resolvePublicAddress("localhost")).rejects.toThrow(/private or local/);
  });
});

describe("sendInvoiceEmail", () => {
  it("sends the PDF through the organization's own server, then records it", async () => {
    const { client, tables } = userClient();
    serverClientMock.mockResolvedValue(client);

    expect(await sendInvoiceEmail(sendForm())).toEqual({ ok: true, message: "Sent to billing@acme.test." });

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const [server, mail] = sendMailMock.mock.calls[0];
    expect(server).toMatchObject({ host: "smtp.example.com", password: "s3cret", replyTo: "owner@acme-consulting.test" });
    expect(mail).toMatchObject({ fromName: "Acme Consulting", to: "billing@acme.test", subject: "Invoice INV-1" });
    expect(mail.attachment.filename).toBe("Invoice-INV-1.pdf");
    expect(tables.invoice_emails.insert).toHaveBeenCalledWith({
      organization_id: "org-1",
      invoice_id: "inv-1",
      sent_to: "billing@acme.test",
      subject: "Invoice INV-1",
    });
  });

  it("refuses a viewer", async () => {
    getCurrentUserRoleMock.mockResolvedValue("viewer");
    serverClientMock.mockResolvedValue(userMock());

    expect(await sendInvoiceEmail(sendForm())).toEqual({ error: "You can't send invoices in this organization." });
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("refuses an attachment that isn't a PDF", async () => {
    serverClientMock.mockResolvedValue(userMock());
    const notPdf = new File(["<html>"], "x.pdf", { type: "application/pdf" });

    expect(await sendInvoiceEmail(sendForm({ pdf: notPdf }))).toEqual({ error: "The attachment isn't a PDF." });
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("refuses a subject with a line break", async () => {
    serverClientMock.mockResolvedValue(userMock());
    const result = await sendInvoiceEmail(sendForm({ subject: "Hi\r\nBcc: everyone@example.com" }));
    expect(result).toHaveProperty("error");
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("refuses a void invoice", async () => {
    serverClientMock.mockResolvedValue(userMock("void"));
    expect(await sendInvoiceEmail(sendForm())).toEqual({ error: "This invoice is void." });
  });

  it("stops at the organization's hourly limit", async () => {
    rateLimitMock.mockResolvedValue(false);
    serverClientMock.mockResolvedValue(userMock());

    expect(await sendInvoiceEmail(sendForm())).toHaveProperty("error");
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("reports a failed send and records nothing", async () => {
    const { client, tables } = userClient();
    serverClientMock.mockResolvedValue(client);
    sendMailMock.mockRejectedValue(new Error("535 Authentication failed"));

    expect(await sendInvoiceEmail(sendForm())).toEqual({ error: "Couldn't send: 535 Authentication failed" });
    expect(tables.invoice_emails.insert).not.toHaveBeenCalled();
  });

  it("says so when no mail server is set up", async () => {
    serverClientMock.mockResolvedValue(userMock());
    adminClientMock.mockReturnValue(createSupabaseMock({ tables: { organization_smtp_settings: { select: ok(null) } } }).client);

    const result = await sendInvoiceEmail(sendForm());
    expect(result).toEqual({ error: expect.stringContaining("isn't set up") });
  });
});

describe("saveMailServer", () => {
  function settingsForm(overrides: Record<string, string> = {}): FormData {
    const fd = new FormData();
    const fields = {
      organizationId: "org-1",
      host: "SMTP.Example.com",
      port: "587",
      username: "mailer",
      password: "s3cret",
      fromAddress: "billing@acme-consulting.test",
      replyTo: "",
      ...overrides,
    };
    for (const [key, value] of Object.entries(fields)) fd.set(key, value);
    return fd;
  }

  it("is owner-only", async () => {
    expect(await saveMailServer(null, settingsForm())).toEqual({ error: "Only an owner can set up email." });
    expect(serverClientMock).not.toHaveBeenCalled();
  });

  it("stores the password encrypted", async () => {
    getCurrentUserRoleMock.mockResolvedValue("owner");
    const { client, tables } = createSupabaseMock({
      tables: { organization_smtp_settings: { update: ok([]), insert: ok(null) } },
    });
    serverClientMock.mockResolvedValue(client);

    expect(await saveMailServer(null, settingsForm())).toEqual({ ok: true, message: "Saved." });

    const inserted = tables.organization_smtp_settings.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted).toMatchObject({ organization_id: "org-1", host: "smtp.example.com", reply_to: null });
    expect(inserted.password_encrypted).not.toContain("s3cret");
    expect(decryptToken(inserted.password_encrypted as string)).toBe("s3cret");
  });

  it("keeps the saved password when the field is left blank", async () => {
    getCurrentUserRoleMock.mockResolvedValue("owner");
    const { client, tables } = createSupabaseMock({
      tables: { organization_smtp_settings: { update: ok([{ organization_id: "org-1" }]) } },
    });
    serverClientMock.mockResolvedValue(client);

    expect(await saveMailServer(null, settingsForm({ password: "" }))).toEqual({ ok: true, message: "Saved." });
    const updated = tables.organization_smtp_settings.update.mock.calls[0][0] as Record<string, unknown>;
    expect(updated).not.toHaveProperty("password_encrypted");
  });

  it("needs a password for a new server", async () => {
    getCurrentUserRoleMock.mockResolvedValue("owner");
    serverClientMock.mockResolvedValue(
      createSupabaseMock({ tables: { organization_smtp_settings: { update: ok([]) } } }).client,
    );

    expect(await saveMailServer(null, settingsForm({ password: "" }))).toEqual({
      error: "Enter the mail server password.",
    });
  });
});
