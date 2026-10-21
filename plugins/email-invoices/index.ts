// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FOQBPlugin } from "@/lib/plugins/types";
import { EmailInvoiceButton } from "./email-invoice-button";
import { MailServerSettings } from "./mail-server-settings";

export const emailInvoicesPlugin: FOQBPlugin = {
  manifest: {
    id: "email-invoices",
    name: "Email invoices",
    version: "0.1.0",
    description: "Email an invoice's PDF to the customer, through each organization's own mail server.",
    requiredEnv: ["ENCRYPTION_KEY"],
  },
  slots: {
    "invoice.actions": EmailInvoiceButton,
    "settings.sections": MailServerSettings,
  },
};
