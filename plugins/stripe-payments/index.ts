// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FOQBPlugin } from "@/lib/plugins/types";
import { PaymentLinkButton } from "./payment-link-button";
import { StripeSettings } from "./stripe-settings";

export const stripePaymentsPlugin: FOQBPlugin = {
  manifest: {
    id: "stripe-payments",
    name: "Stripe payments",
    version: "0.1.0",
    description: "A Stripe payment link on each invoice; payments are recorded against it automatically.",
    requiredEnv: ["ENCRYPTION_KEY"],
  },
  slots: {
    "invoice.actions": PaymentLinkButton,
    "settings.sections": StripeSettings,
  },
};
