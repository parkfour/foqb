// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import type React from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StatementReader } from "@/plugins/statement-import/parse";

export type PluginSettingType =
  | "text"
  | "select"
  | "multiselect"
  | "boolean"
  | "number";

export type PluginSettingValue = string | number | boolean | string[];

export interface PluginSettingOption {
  value: string;
  label: string;
}

export interface PluginSettingDefinition {
  key: string;
  label: string;
  type: PluginSettingType;
  description?: string;
  defaultValue?: PluginSettingValue;
  placeholder?: string;
  options?: PluginSettingOption[];
  required?: boolean;
}

// Settings are readable by every member of the book (plugin_data), so they
// hold choices, never secrets.
export interface OrgPluginConfig {
  enabled: boolean;
  settings: Record<string, PluginSettingValue>;
  updatedAt?: string;
  // For a plugin with a disclaimer: who acknowledged it, and when.
  acknowledgement?: {
    site: { by: string | null; at: string } | null;
    book: { by: string | null; at: string } | null;
  };
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  homepage?: string;
  // Environment variables the plugin needs, for its own docs and checks.
  requiredEnv?: string[];
  // Dynamic settings configurable by an organization administrator.
  settings?: PluginSettingDefinition[];
  // A plugin that stays off until a Site Admin and then each book's owner
  // acknowledge this disclaimer (plugin_acknowledgements). A new version
  // asks again.
  acknowledgement?: PluginAcknowledgement;
}

export interface PluginAcknowledgement {
  version: string;
  title: string;
  // Paragraphs, shown in full above the button.
  text: string[];
}

// Events FOQB emits on the server, after the change has been saved. Each
// fires on every path that makes that change; add one only where that holds.
export interface HookEventMap {
  "invoice:created": {
    invoiceId: string;
    invoiceNumber: string;
    customerId: string | null;
    total: number;
    orgId: string;
  };
  "bill:created": {
    billId: string;
    billNumber: string;
    vendorId: string | null;
    total: number;
    orgId: string;
  };
  // A payment, possibly partial; invoiceStatus says whether it's now paid.
  "invoice_payment:recorded": {
    paymentId: string;
    invoiceId: string;
    invoiceStatus: string;
    orgId: string;
  };
  "bill_payment:recorded": {
    paymentId: string;
    billId: string;
    billStatus: string;
    orgId: string;
  };
  // Voided, with any payments it had undone (their bank rows go back to
  // the feed).
  "invoice:voided": { invoiceId: string; invoiceNumber: string; orgId: string };
  "bill:voided": { billId: string; billNumber: string; orgId: string };
  "estimate:created": {
    estimateId: string;
    estimateNumber: string;
    customerId: string;
    subtotal: number;
    orgId: string;
  };
  // accepted, declined, or invoiced (turned into invoiceId).
  "estimate:status_changed": {
    estimateId: string;
    estimateNumber: string;
    status: "open" | "accepted" | "declined" | "invoiced";
    invoiceId: string | null;
    orgId: string;
  };
  // A credit memo applied to an invoice also fires invoice_payment:recorded.
  "credit_memo:created": {
    creditMemoId: string;
    memoNumber: string;
    customerId: string;
    total: number;
    appliedToInvoiceId: string | null;
    orgId: string;
  };
  "customer:created": { customerId: string; name: string; email: string | null; orgId: string };
  "vendor:created": { vendorId: string; name: string; email: string | null; orgId: string };
  // The three below are recorded by the database whatever made the change
  // (a page, the bank feed, a database function) and delivered by a
  // background job, usually within a few minutes, at least once: a
  // handler may see one twice.
  "journal_entry:posted": { journalEntryId: string; entryDate: string; memo: string | null; orgId: string };
  "bank_transaction:imported": {
    bankTransactionId: string;
    accountId: string;
    date: string;
    name: string;
    amount: number; // negative = money out
    orgId: string;
  };
  // The book's books are closed through lockDate (null: unlocked).
  "period:locked": { lockDate: string | null; previousLockDate: string | null; orgId: string };
}

export type HookEvent = keyof HookEventMap;

// What each UI slot hands the components plugged into it.
export interface SlotContextMap {
  // Beside "Download / Share PDF" on an invoice.
  "invoice.actions": {
    invoiceId: string;
    invoiceNumber: string;
    customer: { name: string; email: string | null } | null;
    total: number;
    remaining: number;
    dueDate: string | null;
    status: string;
    // The same PDF "Download / Share PDF" makes.
    buildPdf: () => Promise<File>;
  };
  // On the Settings page, inside the plugin's own card.
  "settings.sections": {
    organizationId: string;
  };
  // At the top of the Reconcile page: the book's bank, card and loan
  // accounts.
  "reconcile.header": {
    accounts: { id: string; name: string; account_number: string; type: string }[];
  };
  // Below the dashboard's own figures, for a household or a business: a
  // reminder or a figure of the plugin's.
  "dashboard.sections": {
    organizationId: string;
    workspaceType: WorkspaceType;
    canWrite: boolean;
  };
  // A section of its own on the Properties & Assets page.
  "properties.sections": {
    organizationId: string;
    canWrite: boolean;
  };
  // Beside an estimate's status buttons.
  "estimate.actions": {
    estimateId: string;
    estimateNumber: string;
    customer: { name: string; email: string | null } | null;
    subtotal: number;
    status: string;
  };
  // Beside "Print or save as PDF" on a customer statement.
  "statement.actions": {
    customerId: string;
    customer: { name: string; email: string | null };
    start: string;
    end: string;
    amountDue: number;
  };
  // Above the Enter Bill form; prefill fills in whatever it's given.
  "bill.header": {
    vendors: { id: string; name: string }[];
    accounts: { id: string; name: string; account_number: string }[];
    prefill: (bill: BillPrefill) => void;
  };
}

export type SlotName = keyof SlotContextMap;

export interface BillPrefill {
  vendorId?: string;
  billNumber?: string;
  billDate?: string;
  lines?: { accountId?: string; description: string; quantity: number; unitPrice: number }[];
  // The receipt itself, attached to the bill's entry when it's saved.
  attachment?: File;
}

export type SlotComponent<K extends SlotName> = React.ComponentType<{ context: SlotContextMap[K] }>;

export type WorkspaceType = "business" | "household";

// What a plugin page is handed. books is every book the signed-in user
// belongs to, for a page that reads across them (a household's tax return
// takes in its businesses' books); each read still goes through that
// book's own access rules. Each book's amounts are in its own currency.
export interface PluginPageContext {
  organizationId: string;
  workspaceType: WorkspaceType;
  canWrite: boolean;
  books: { id: string; name: string; workspaceType: WorkspaceType; currency: string }[];
}

// A page of the plugin's own at /plugins/<plugin id>/<slug>, listed in the
// menu. It renders in the browser, like a slot.
export interface PluginPage {
  slug: string;
  title: string;
  description?: string;
  // Listed only for books of this kind; for both when unset.
  workspace?: WorkspaceType;
  component: React.ComponentType<{ context: PluginPageContext }>;
}

// A report of the plugin's own, listed under Financial Reports. It renders
// in the browser, like a page.
export interface PluginReportContext {
  organizationId: string;
  start: string;
  end: string;
  asOf: string;
}

export interface PluginReport {
  id: string;
  title: string;
  // Over a date range (start and end), or as of one date.
  range: boolean;
  workspace?: WorkspaceType;
  component: React.ComponentType<{ context: PluginReportContext }>;
}

export interface FOQBPlugin {
  manifest: PluginManifest;
  init?: () => void | Promise<void>;
  hooks?: { [K in HookEvent]?: (payload: HookEventMap[K]) => void | Promise<void> };
  slots?: { [K in SlotName]?: SlotComponent<K> };
  pages?: PluginPage[];
  reports?: PluginReport[];
  // More bank layouts for the statement-import plugin, tried alongside its
  // own (see docs/PLUGINS.md). Run in the browser.
  statementReaders?: StatementReader[];
  // Dynamic settings configurable by an organization administrator.
  settings?: PluginSettingDefinition[];
}

// Background work, run off real traffic like FOQB's own maintenance (see
// lib/cron/piggyback.ts): at most once per minIntervalSeconds per instance.
export interface PluginJob {
  name: string;
  minIntervalSeconds: number;
  run: () => Promise<unknown>;
}

// The parts of a plugin that only the server may load: handlers and jobs
// that use secrets, the service-role key or the network. Listed in
// plugins/server.ts, which the browser never imports.
export interface ServerPluginParts {
  hooks?: FOQBPlugin["hooks"];
  jobs?: PluginJob[];
  categorizers?: BankCategorizer[];
  exchangeRates?: ExchangeRateSource;
  securityPrices?: SecurityPriceSource;
  // The ones below are asked only for books the plugin is on in.
  invoiceNotes?: InvoiceNotesSource;
  invoiceChecks?: InvoiceCheck[];
  mailer?: BookMailer;
  bankFeed?: BankFeedSource;
  salesTaxLookup?: SalesTaxLookup;
}

// Lines printed at the foot of an invoice and its PDF: a VAT number,
// "Reverse charge", payment instructions.
export type InvoiceNotesSource = (
  admin: SupabaseClient,
  invoice: { id: string; organizationId: string; customerId: string | null },
) => Promise<string[]>;

// Asked before an invoice is saved, on every path that creates one. A
// message refuses it, and is shown to whoever was making it; null lets it
// through. One that throws is logged and passed over.
export interface InvoiceCheckInput {
  organizationId: string;
  customerId: string;
  invoiceDate: string;
  subtotal: number;
  taxAmount: number;
  taxRateIds: string[];
  lines: { account_id: string; amount: number; item_id?: string | null }[];
}
export type InvoiceCheck = (admin: SupabaseClient, invoice: InvoiceCheckInput) => Promise<string | null>;

// Sends mail as the book. Used by FOQB and other plugins through
// sendBookMail (lib/plugins/server-loader.ts); the first plugin on in the
// book with a mailer sends it. Throws if it couldn't.
export interface BookMail {
  to: string;
  subject: string;
  text: string;
  attachment?: { filename: string; content: Buffer; contentType: string };
}
export interface BookMailer {
  // Whether the book has it set up (a mail server, say).
  ready: (organizationId: string) => Promise<boolean>;
  send: (organizationId: string, mail: BookMail) => Promise<void>;
}

// A bank feed of the plugin's own (a provider FOQB doesn't build in).
// The plugin keeps each book's connection (in plugin_data, encrypted) and
// returns what the bank has; FOQB adds a ledger account for each new bank
// account, books the transactions through the rules and categorizers like
// any feed, skips ones it already has, and records balances. Amounts are
// FOQB's sign: negative is money out. Fetched every minIntervalSeconds
// for each book the plugin is on in.
export interface BankFeedTransaction {
  id: string;
  date: string;
  name: string;
  amount: number;
}
export interface BankFeedAccount {
  id: string;
  name: string;
  kind: "asset" | "liability";
  // Last four digits, to tell two accounts apart.
  mask?: string | null;
  // Owed is positive for a card or loan, as banks show it.
  balance?: number | null;
  available?: number | null;
  transactions: BankFeedTransaction[];
}
export interface BankFeedSource {
  name: string;
  minIntervalSeconds: number;
  fetch: (organizationId: string) => Promise<BankFeedAccount[]>;
}

// Sales tax rates for an address, offered under Settings → Sales tax.
export interface SalesTaxAddress {
  street?: string;
  city?: string;
  state?: string;
  zip: string;
  country: string;
}
export interface SalesTaxLookup {
  name: string;
  rates: (address: SalesTaxAddress) => Promise<{ name: string; rate: number }[]>;
}

// The latest closing price of a security, by its symbol, for the holdings
// page. Stored as a price the book can see and change.
export interface SecurityPrice {
  price: number;
  asOf: string; // YYYY-MM-DD
  source: string;
}

export interface SecurityPriceSource {
  price: (symbol: string) => Promise<SecurityPrice | null>;
}

// A quote for one unit of `from` in `to`, to show a book kept in another
// currency beside this one's. Shown, never booked.
export interface ExchangeRate {
  rate: number;
  asOf: string; // YYYY-MM-DD, the day the quote is for
  source: string;
}

export interface ExchangeRateSource {
  rate: (from: string, to: string) => Promise<ExchangeRate | null>;
}

// Gets the first look at each new bank transaction, before the book's rules
// (the bank feed and statement imports both). Returns true if it booked the
// row itself; false leaves it to the rules. One that throws is logged and
// passed over.
export type BankCategorizer = (
  supabase: SupabaseClient,
  organizationId: string,
  bankAccountId: string,
  row: { id: string; date: string; name: string; amount: number },
) => Promise<boolean>;
