// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FOQBPlugin } from "@/lib/plugins/types";

// Fetching quotes is server-only: plugins/server.ts.
export const exchangeRatesPlugin: FOQBPlugin = {
  manifest: {
    id: "exchange-rates",
    name: "Exchange rates",
    version: "0.1.0",
    description:
      "Show the businesses you own that keep books in another currency in a household's net worth, at the European Central Bank's reference rate.",
  },
};
