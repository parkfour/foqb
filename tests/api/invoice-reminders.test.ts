import { describe, expect, it } from "vitest";
import { createSupabaseMock, ok } from "./supabase-mock";
import { findOverdue, reminderText } from "@/plugins/email-invoices/reminders";
import type { SupabaseClient } from "@supabase/supabase-js";

const invoice = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  invoice_number: id,
  due_date: "2026-09-01",
  tax_amount: 0,
  customers: { name: "Ann", email: "ann@example.com" },
  invoice_lines: [{ amount: 100 }],
  invoice_payments: [{ amount: 30 }],
  invoice_emails: [{ kind: "invoice" }],
  ...over,
});

describe("findOverdue", () => {
  it("keeps unpaid invoices to customers with an email that haven't had a reminder", async () => {
    const { client } = createSupabaseMock({
      tables: {
        invoices: {
          select: ok([
            invoice("due"),
            invoice("reminded", { invoice_emails: [{ kind: "reminder" }] }),
            invoice("no-email", { customers: { name: "Bob", email: null } }),
            invoice("settled", { invoice_payments: [{ amount: 100 }] }),
          ]),
        },
      },
    });
    const overdue = await findOverdue(client as unknown as SupabaseClient, "org", "2026-09-15");
    expect(overdue).toEqual([{ id: "due", invoice_number: "due", due_date: "2026-09-01", customer: "Ann", email: "ann@example.com", owed: 70 }]);
  });
});

describe("reminderText", () => {
  it("names the invoice, its due date and what's left", () => {
    const { subject, text } = reminderText(
      "Acme",
      { id: "x", invoice_number: "1042", due_date: "2026-09-01", owed: 70, customer: "Ann", email: "ann@example.com" },
      "USD",
    );
    expect(subject).toBe("Reminder: invoice 1042 from Acme is past due");
    expect(text).toContain("invoice 1042, due 2026-09-01, still has $70.00 to pay");
  });
});
