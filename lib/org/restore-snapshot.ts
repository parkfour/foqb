// Shape check for an uploaded backup file before it's passed through to
// restore_organization() — catches an obviously wrong/corrupted file with a
// readable message instead of a raw SQL error from deep inside the
// restore function.
const REQUIRED_ARRAY_KEYS = [
  "accounts",
  "journal_entries",
  "customers",
  "vendors",
  "invoices",
  "bills",
  "invoice_payments",
  "bill_payments",
  "items",
  "inventory_items",
  "fixed_assets",
  "recurring_invoices",
  "recurring_bills",
  "bank_transactions",
  "bank_reconciliations",
  "categorization_rules",
] as const;

export interface OrganizationSnapshot {
  organization: { id: string; name: string; [key: string]: unknown };
  [key: string]: unknown;
}

export type SnapshotValidationResult =
  | { valid: true; snapshot: OrganizationSnapshot }
  | { valid: false; error: string };

export function validateOrganizationSnapshot(json: unknown): SnapshotValidationResult {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return { valid: false, error: "This doesn't look like a FOQB backup file." };
  }

  const record = json as Record<string, unknown>;
  const organization = record.organization;

  if (
    typeof organization !== "object" ||
    organization === null ||
    typeof (organization as Record<string, unknown>).id !== "string" ||
    typeof (organization as Record<string, unknown>).name !== "string"
  ) {
    return { valid: false, error: "This backup file is missing its organization details." };
  }

  for (const key of REQUIRED_ARRAY_KEYS) {
    if (!Array.isArray(record[key])) {
      return { valid: false, error: `This backup file is missing or has a malformed "${key}" section.` };
    }
  }

  return { valid: true, snapshot: record as OrganizationSnapshot };
}
