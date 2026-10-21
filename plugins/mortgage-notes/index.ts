// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FOQBPlugin } from "@/lib/plugins/types";
import { MortgageNotesSection } from "./notes-section";

// Booking borrowers' payments is server-only: plugins/server.ts.
export const mortgageNotesPlugin: FOQBPlugin = {
  manifest: {
    id: "mortgage-notes",
    name: "Mortgage notes",
    version: "0.1.0",
    description: "Mortgages you hold: borrowers' payments split into interest, principal and escrow, and Form 1098 figures.",
    requiredEnv: ["ENCRYPTION_KEY"],
  },
  slots: { "properties.sections": MortgageNotesSection },
};
