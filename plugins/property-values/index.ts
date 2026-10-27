// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FOQBPlugin } from "@/lib/plugins/types";
import { PropertyValuesSection } from "./values-section";
import { ApiKeySettings } from "./api-key-settings";

// The lookups are server-only: plugins/server.ts.
export const propertyValuesPlugin: FOQBPlugin = {
  manifest: {
    id: "property-values",
    name: "Property values",
    version: "0.2.0",
    description:
      "Value each property, and the property securing each mortgage note, side by side: FHFA's house price index for its area (a free FRED key), RentCast's market estimate (a RentCast key), and a Zillow estimate where the instance has one. Addresses go to the services you set up.",
    requiredEnv: ["ENCRYPTION_KEY"],
    settings: [
      {
        key: "autoUpdate",
        label: "Replace estimated values weekly",
        type: "boolean",
        description: "Each property's estimated value is replaced with the figure below. Values you entered are overwritten.",
        defaultValue: false,
      },
      {
        key: "source",
        label: "With",
        type: "select",
        options: [
          { value: "fhfa", label: "The house price index value (needs a FRED key)" },
          { value: "rentcast", label: "RentCast's estimate (needs a RentCast key)" },
          { value: "zillow", label: "A Zillow estimate (the instance's property-data API)" },
        ],
        defaultValue: "fhfa",
      },
      {
        key: "rentcastLimit",
        label: "RentCast lookups a month, at most",
        type: "number",
        description: "Its free plan includes 50 and charges for each one past that. Each property is looked up at most once a week.",
        defaultValue: 40,
      },
      {
        key: "showZillow",
        label: "Show Zillow estimates",
        type: "boolean",
        description: "Only where the instance subscribes to a property-data API (PROPERTY_VALUE_API_URL); addresses are sent to it.",
        defaultValue: false,
      },
    ],
  },
  slots: {
    "properties.sections": PropertyValuesSection,
    "settings.sections": ApiKeySettings,
  },
};
