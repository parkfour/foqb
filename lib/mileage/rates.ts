// IRS business standard mileage rates, dollars per mile, from each date on.
// A trip keeps the rate it was entered with, so a correction here changes
// only new trips. Check irs.gov when adding a year.
const RATES: { from: string; rate: number }[] = [
  { from: "2023-01-01", rate: 0.655 },
  { from: "2024-01-01", rate: 0.67 },
  { from: "2025-01-01", rate: 0.7 },
  // IR-2025-128.
  { from: "2026-01-01", rate: 0.725 },
  // Mid-year rise for fuel prices (Internal Revenue Bulletin 2026-29).
  { from: "2026-07-01", rate: 0.76 },
];

export function standardMileageRate(date: string): number {
  let rate = RATES[0].rate;
  for (const r of RATES) if (date >= r.from) rate = r.rate;
  return rate;
}

export const mileageAmount = (miles: number, rate: number): number => Math.round(miles * rate * 100) / 100;
