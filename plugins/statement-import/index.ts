// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FOQBPlugin } from "@/lib/plugins/types";
import { StatementImporter } from "./statement-importer";

export const statementImportPlugin: FOQBPlugin = {
  manifest: {
    id: "statement-import",
    name: "Statement import",
    version: "0.1.0",
    description: "Add a bank or card statement's transactions from its PDF, read on the device, and reconcile it.",
  },
  slots: { "reconcile.header": StatementImporter },
};
