// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// EU member states' standard VAT rates, percent, as of late 2025 (Finland
// 25.5% from September 2024, Slovakia 23% from 2025, Estonia 24% from July
// 2025, Romania 21% from August 2025). Rates change: check the European
// Commission's TEDB (taxation-customs.ec.europa.eu) before relying on one.
// Reduced rates vary by product, so they're added by hand.
export const EU_STANDARD_RATES: Record<string, { name: string; rate: number }> = {
  AT: { name: "Austria", rate: 20 },
  BE: { name: "Belgium", rate: 21 },
  BG: { name: "Bulgaria", rate: 20 },
  HR: { name: "Croatia", rate: 25 },
  CY: { name: "Cyprus", rate: 19 },
  CZ: { name: "Czechia", rate: 21 },
  DK: { name: "Denmark", rate: 25 },
  EE: { name: "Estonia", rate: 24 },
  FI: { name: "Finland", rate: 25.5 },
  FR: { name: "France", rate: 20 },
  DE: { name: "Germany", rate: 19 },
  GR: { name: "Greece", rate: 24 },
  HU: { name: "Hungary", rate: 27 },
  IE: { name: "Ireland", rate: 23 },
  IT: { name: "Italy", rate: 22 },
  LV: { name: "Latvia", rate: 21 },
  LT: { name: "Lithuania", rate: 21 },
  LU: { name: "Luxembourg", rate: 17 },
  MT: { name: "Malta", rate: 18 },
  NL: { name: "Netherlands", rate: 21 },
  PL: { name: "Poland", rate: 23 },
  PT: { name: "Portugal", rate: 23 },
  RO: { name: "Romania", rate: 21 },
  SK: { name: "Slovakia", rate: 23 },
  SI: { name: "Slovenia", rate: 22 },
  ES: { name: "Spain", rate: 21 },
  SE: { name: "Sweden", rate: 25 },
};

// A VAT number's shape: the country prefix (EL for Greece) and 2 to 13
// letters or digits. Only the shape; VIES checks it's real.
export function isVatNumberShape(vat: string): boolean {
  return /^(AT|BE|BG|HR|CY|CZ|DK|EE|FI|FR|DE|EL|HU|IE|IT|LV|LT|LU|MT|NL|PL|PT|RO|SK|SI|ES|SE|XI)[0-9A-Z+*]{2,13}$/.test(
    vat.replace(/[\s.-]/g, "").toUpperCase(),
  );
}
