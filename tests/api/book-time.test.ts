import { describe, expect, it } from "vitest";
import {
  addDays,
  changesOverlapping,
  formatTimestamp,
  isValidTimezone,
  localDate,
  monthStart,
  type TimezoneChange,
} from "@/lib/time/book-time";

// 2026-10-18 01:30 UTC: still Oct 17 in Chicago, already Oct 18 in Berlin.
const AT = new Date("2026-10-18T01:30:00Z");

describe("book time", () => {
  it("gives each timezone its own today", () => {
    expect(localDate("America/Chicago", AT)).toBe("2026-10-17");
    expect(localDate("Europe/Berlin", AT)).toBe("2026-10-18");
    expect(localDate("UTC", AT)).toBe("2026-10-18");
  });

  it("does calendar arithmetic without a timezone", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(monthStart("2026-10-17")).toBe("2026-10-01");
  });

  it("shows a moment in the book's timezone with its abbreviation", () => {
    expect(formatTimestamp(AT, "America/Chicago")).toBe("Oct 17, 2026, 8:30 PM CDT");
    expect(formatTimestamp(AT, "Europe/Berlin")).toBe("Oct 18, 2026, 3:30 AM CEST");
  });

  it("rejects names that aren't timezones", () => {
    expect(isValidTimezone("America/Chicago")).toBe(true);
    expect(isValidTimezone("Mars/Olympus")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
  });

  it("finds the changes whose affected days overlap a range", () => {
    const change: TimezoneChange = {
      changedAt: "2026-10-18T01:30:00Z",
      oldTimezone: "America/Chicago",
      newTimezone: "Europe/Berlin",
      firstAffected: "2026-10-17",
      lastAffected: "2026-10-18",
    };
    expect(changesOverlapping([change], "2026-10-01", "2026-10-17")).toHaveLength(1);
    expect(changesOverlapping([change], "2026-10-18", "2026-10-31")).toHaveLength(1);
    expect(changesOverlapping([change], "2026-10-19", "2026-10-31")).toHaveLength(0);
    expect(changesOverlapping([change], "2026-10-01", "2026-10-16")).toHaveLength(0);
  });
});
