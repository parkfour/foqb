// Amounts in a book's currency. Each book has one (organizations.currency);
// Intl knows each currency's symbol and decimals (none for KRW or JPY).
const formatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(value: number, currency = "USD"): string {
  let formatter = formatters.get(currency);
  if (!formatter) {
    // "negative": a balance that rounds to zero reads $0.00, not -$0.00.
    formatter = new Intl.NumberFormat("en-US", { style: "currency", currency, signDisplay: "negative" });
    formatters.set(currency, formatter);
  }
  return formatter.format(value);
}

export function isValidCurrency(code: string | null | undefined): code is string {
  return !!code && /^[A-Z]{3}$/.test(code) && Intl.supportedValuesOf("currency").includes(code);
}
