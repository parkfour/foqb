// Dates as a book (organization) sees them. Stored dates are plain
// YYYY-MM-DD calendar dates and never shift; the book's timezone only
// decides which date "today" is, and how timestamps are shown.
// Pure functions: safe in the browser and on the server.

export function isValidTimezone(timeZone: string | null | undefined): timeZone is string {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

// The calendar date it is right now (or at `at`) in the timezone.
export function localDate(timeZone: string, at: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

// Calendar arithmetic on YYYY-MM-DD, independent of any timezone.
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isMonthEnd(date: string): boolean {
  return addDays(date, 1).endsWith("-01");
}

// A moment, shown in the book's timezone with its abbreviation, e.g.
// "Oct 17, 2026, 9:14 PM CDT".
export function formatTimestamp(at: string | Date, timeZone: string): string {
  const when = new Intl.DateTimeFormat("en-US", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(
    new Date(at),
  );
  return `${when} ${timeZoneAbbreviation(at, timeZone)}`;
}

// Just the book's calendar date of a moment, e.g. "Oct 17, 2026".
export function formatTimestampDate(at: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, dateStyle: "medium" }).format(new Date(at));
}

// en-US knows the American abbreviations (CDT) and en-GB the European ones
// (CEST); each gives "GMT+2"-style offsets for the rest.
function timeZoneAbbreviation(at: string | Date, timeZone: string): string {
  const name = (locale: string) =>
    new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: "short" })
      .formatToParts(new Date(at))
      .find((p) => p.type === "timeZoneName")?.value ?? timeZone;
  const american = name("en-US");
  return american.startsWith("GMT") ? name("en-GB") : american;
}

export interface TimezoneChange {
  changedAt: string;
  oldTimezone: string;
  newTimezone: string;
  firstAffected: string;
  lastAffected: string;
}

// Changes whose affected days overlap [from, to] (inclusive dates).
export function changesOverlapping(changes: TimezoneChange[], from: string, to: string): TimezoneChange[] {
  return changes.filter((c) => c.firstAffected <= to && c.lastAffected >= from);
}
