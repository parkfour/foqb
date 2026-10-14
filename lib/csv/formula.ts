// Spreadsheet apps run a cell starting with =, +, -, @, tab or carriage
// return as a formula, so exported text could carry one (e.g. an account
// named "=HYPERLINK(...)"). Exports prefix such text with ' (Papa's
// escapeFormulae; numbers are left alone); imports drop that ' again, so
// our own exports round-trip.
export const CSV_EXPORT_OPTIONS = { escapeFormulae: true } as const;

export function unescapeFormula(value: string): string {
  return value.replace(/^'(?=[=+\-@\t\r])/, "");
}
