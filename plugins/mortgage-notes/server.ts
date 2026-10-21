// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ServerPluginParts } from "@/lib/plugins/types";
import { categorizeNotePayment } from "./notes";

export const mortgageNotesServer: ServerPluginParts = {
  categorizers: [categorizeNotePayment],
};
