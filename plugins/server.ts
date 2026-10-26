// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ServerPluginParts } from "@/lib/plugins/types";
import { webhooksServer } from "./webhooks/server";
import { mortgageNotesServer } from "./mortgage-notes/server";
import { exchangeRatesServer } from "./exchange-rates/server";
import { emailInvoicesServer } from "./email-invoices/server";
import { securityPricesServer } from "./security-prices/server";
import { propertyValuesServer } from "./property-values/server";
import { euVatServer } from "./eu-vat/server";
import { localServerParts } from "./local-server.generated";

// The server-only parts of the plugins in plugins/index.ts, by plugin id.
// Never imported by the browser (see lib/plugins/server-loader.ts).
export const serverPluginParts: Record<string, ServerPluginParts> = {
  webhooks: webhooksServer,
  "mortgage-notes": mortgageNotesServer,
  "exchange-rates": exchangeRatesServer,
  "email-invoices": emailInvoicesServer,
  "security-prices": securityPricesServer,
  "property-values": propertyValuesServer,
  "eu-vat": euVatServer,
  ...localServerParts,
};
