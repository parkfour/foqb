// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FOQBPlugin } from "@/lib/plugins/types";

// The lookups are server-only: plugins/server.ts.
export const propertyValuesPlugin: FOQBPlugin = {
  manifest: {
    id: "property-values",
    name: "Property values",
    version: "0.1.0",
    description:
      "Update each property's estimated value weekly from a Zillow estimate (a Zestimate), through a property-data API you subscribe to. Each property's address is sent to it.",
    requiredEnv: ["PROPERTY_VALUE_API_URL", "PROPERTY_VALUE_API_KEY"],
    settings: [
      {
        key: "autoUpdate",
        label: "Update property values weekly",
        type: "boolean",
        description: "Sends each property's address to the instance's property-data API. Values you entered are replaced.",
        defaultValue: false,
      },
    ],
  },
};
