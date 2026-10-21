// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FOQBPlugin } from "@/lib/plugins/types";
import { ReceiptScanner } from "./receipt-scanner";

export const receiptOcrPlugin: FOQBPlugin = {
  manifest: {
    id: "receipt-ocr",
    name: "Receipt scanning",
    version: "0.1.0",
    description: "Fill in a bill from a photo or PDF of the receipt, read on the device.",
  },
  slots: { "bill.header": ReceiptScanner },
};
