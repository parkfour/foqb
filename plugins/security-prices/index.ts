// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FOQBPlugin } from "@/lib/plugins/types";

// Fetching prices is server-only: plugins/server.ts.
export const securityPricesPlugin: FOQBPlugin = {
  manifest: {
    id: "security-prices",
    name: "Security prices",
    version: "0.1.0",
    description:
      "Fill in the latest closing prices of the stocks and funds on the Investments page, from Stooq's free daily quotes. Only the symbols are sent.",
  },
};
