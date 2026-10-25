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
  // On unless FOQB_PLUGINS says otherwise. Default false: an instance only
  // runs a plugin its operator turned on.
  enabledByDefault?: boolean;
  // Dynamic settings configurable by an organization administrator.
  settings?: PluginSettingDefinition[];
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

export interface FOQBPlugin {
  manifest: PluginManifest;
  init?: () => void | Promise<void>;
  hooks?: { [K in HookEvent]?: (payload: HookEventMap[K]) => void | Promise<void> };
  slots?: { [K in SlotName]?: SlotComponent<K> };
  pages?: PluginPage[];
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
