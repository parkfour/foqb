// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FOQBPlugin } from "@/lib/plugins/types";
import { emailInvoicesPlugin } from "./email-invoices";
import { receiptOcrPlugin } from "./receipt-ocr";
import { statementImportPlugin } from "./statement-import";
import { webhooksPlugin } from "./webhooks";
import { mortgageNotesPlugin } from "./mortgage-notes";
import { startupAssistantPlugin } from "./startup-assistant";
import { exchangeRatesPlugin } from "./exchange-rates";
import { localPlugins } from "./local.generated";

// Plugins shipped in this repository, each off until FOQB_PLUGINS names it
// (see docs/PLUGINS.md).
export const builtInPlugins: FOQBPlugin[] = [
  emailInvoicesPlugin,
  webhooksPlugin,
  receiptOcrPlugin,
  statementImportPlugin,
  mortgageNotesPlugin,
  startupAssistantPlugin,
  exchangeRatesPlugin,
];

// Those plus the private plugins checked out under plugins/local. A private
// plugin can't take a shipped one's id.
export const availablePlugins: FOQBPlugin[] = [...builtInPlugins, ...localPlugins];
const ids = availablePlugins.map((p) => p.manifest.id);
const duplicate = ids.find((id, i) => ids.indexOf(id) !== i);
if (duplicate) throw new Error(`Two plugins have the id "${duplicate}"`);
