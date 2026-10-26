// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FOQBPlugin } from "@/lib/plugins/types";
import { EmailInvoiceButton } from "./email-invoice-button";
import { MailServerSettings } from "./mail-server-settings";
import { EmailEstimateButton, EmailStatementButton } from "./email-document-button";

export const emailInvoicesPlugin: FOQBPlugin = {
  manifest: {
    id: "email-invoices",
    name: "Email invoices",
    version: "0.1.0",
    description: "Email an invoice's PDF, an estimate or a statement to the customer, through each organization's own mail server.",
    requiredEnv: ["ENCRYPTION_KEY"],
    settings: [
      {
        key: "reminderDays",
        label: "Overdue reminders",
        type: "number",
        description: "Email a customer once when an invoice is this many days past due. 0 sends none.",
        defaultValue: 0,
      },
    ],
  },
  slots: {
    "invoice.actions": EmailInvoiceButton,
    "estimate.actions": EmailEstimateButton,
    "statement.actions": EmailStatementButton,
    "settings.sections": MailServerSettings,
  },
};
