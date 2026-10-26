// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { HookEvent } from "@/lib/plugins/types";

// Every event a webhook can subscribe to, with its label; the busy ones
// (every posted entry, every bank row) start unticked.
export const WEBHOOK_EVENTS = {
  "invoice:created": { label: "Invoice created", byDefault: true },
  "invoice:voided": { label: "Invoice voided", byDefault: true },
  "invoice_payment:recorded": { label: "Customer payment recorded", byDefault: true },
  "credit_memo:created": { label: "Credit memo created", byDefault: true },
  "estimate:created": { label: "Estimate created", byDefault: true },
  "estimate:status_changed": { label: "Estimate accepted, declined or invoiced", byDefault: true },
  "customer:created": { label: "Customer added", byDefault: true },
  "bill:created": { label: "Bill created", byDefault: true },
  "bill:voided": { label: "Bill voided", byDefault: true },
  "bill_payment:recorded": { label: "Vendor payment recorded", byDefault: true },
  "vendor:created": { label: "Vendor added", byDefault: true },
  "period:locked": { label: "Books closed (period lock date changed)", byDefault: true },
  "journal_entry:posted": { label: "Any journal entry posted", byDefault: false },
  "bank_transaction:imported": { label: "Any bank transaction imported", byDefault: false },
} as const satisfies Partial<Record<HookEvent, { label: string; byDefault: boolean }>>;

export type WebhookEvent = keyof typeof WEBHOOK_EVENTS;
