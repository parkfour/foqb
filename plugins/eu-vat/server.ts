// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SupabaseClient } from "@supabase/supabase-js";
import { getPluginData } from "@/lib/plugins/data";
import type { InvoiceCheckInput, ServerPluginParts } from "@/lib/plugins/types";
import type { ReverseChargeCustomers, VatSettings } from "./actions";

const PLUGIN = "eu-vat";

// The seller's VAT number on every invoice; for a reverse-charge customer,
// theirs and the reverse-charge wording EU invoicing rules ask for.
export function vatNotes(settings: VatSettings | null, reverseCharge: ReverseChargeCustomers, customerId: string | null): string[] {
  const notes = settings?.vatNumber ? [`VAT number: ${settings.vatNumber}`] : [];
  const customer = customerId ? reverseCharge[customerId] : undefined;
  if (customer) {
    notes.push(
      `Customer VAT number: ${customer.vatNumber}`,
      "Reverse charge: VAT to be accounted for by the customer (Article 196, Council Directive 2006/112/EC).",
    );
  }
  return notes;
}

export function vatRefusal(reverseCharge: ReverseChargeCustomers, invoice: Pick<InvoiceCheckInput, "customerId" | "taxAmount">): string | null {
  return reverseCharge[invoice.customerId] && invoice.taxAmount > 0
    ? "This customer is reverse charge (VAT plugin): invoice them without VAT."
    : null;
}

const reverseChargeOf = async (admin: SupabaseClient, orgId: string) =>
  (await getPluginData<ReverseChargeCustomers>(admin, orgId, PLUGIN, "reverse-charge")) ?? {};

export const euVatServer: ServerPluginParts = {
  invoiceNotes: async (admin, invoice) =>
    vatNotes(
      await getPluginData<VatSettings>(admin, invoice.organizationId, PLUGIN, "settings"),
      await reverseChargeOf(admin, invoice.organizationId),
      invoice.customerId,
    ),
  invoiceChecks: [async (admin, invoice) => vatRefusal(await reverseChargeOf(admin, invoice.organizationId), invoice)],
};
