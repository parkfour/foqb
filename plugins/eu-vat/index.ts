// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FOQBPlugin } from "@/lib/plugins/types";
import { VatPage } from "./vat-page";
import { VatReport } from "./vat-report";

export const euVatPlugin: FOQBPlugin = {
  manifest: {
    id: "eu-vat",
    name: "EU VAT",
    version: "0.1.0",
    description:
      "VAT for a business registered in an EU country: your country's rates as named tax rates, reverse-charge customers, input VAT, and a VAT summary by rate for each period. Files nothing.",
    acknowledgement: {
      version: "2026-10-25",
      title: "EU VAT: talk to your tax adviser before relying on this",
      text: [
        "This plugin is not tax or legal advice, and it does not file VAT returns or pay anything. It keeps VAT rates as named tax rates, marks reverse-charge customers, and adds up a period's output and input VAT.",
        "VAT rules differ by country and change often. Rates, what each applies to, invoice wording, reverse charge, the One-Stop Shop (OSS), distance-selling thresholds, imports and each country's return boxes are not handled for you. The standard rates it suggests may be out of date.",
        "It doesn't check VAT numbers against VIES, so a reverse-charge sale to a number that isn't valid could leave you owing the VAT. Wrong or late returns bring penalties and interest.",
        "Before you charge VAT, file a return or claim input VAT, have an accountant or tax adviser in your country review the setup and the figures. You are responsible for what you file and pay.",
      ],
    },
  },
  reports: [{ id: "vat-summary", title: "VAT summary", range: true, workspace: "business", component: VatReport }],
  pages: [
    {
      slug: "summary",
      title: "VAT",
      description: "VAT rates, reverse-charge customers, and the VAT summary for a period.",
      workspace: "business",
      component: VatPage,
    },
  ],
};
