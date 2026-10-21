import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { BookClockProvider } from "@/components/providers/book-clock-provider";
import { TimezoneChangeNotice } from "@/components/ui/timezone-change-notice";
import { JournalEntryForm } from "@/components/transactions/journal-entry-form";
import type { TimezoneChange } from "@/lib/time/book-time";

vi.mock("@/components/providers/online-status-provider", () => ({ useOnlineStatus: () => true }));

const change: TimezoneChange = {
  changedAt: "2026-10-18T01:30:00Z",
  oldTimezone: "America/Chicago",
  newTimezone: "Europe/Berlin",
  firstAffected: "2026-10-17",
  lastAffected: "2026-10-18",
};

beforeEach(() => {
  // Oct 17 in Chicago, Oct 18 in Berlin and UTC.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-18T01:30:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("book clock", () => {
  it("defaults a form's date to the book's today, not the device's", () => {
    render(
      <BookClockProvider timeZone="America/Chicago" changes={[]}>
        <JournalEntryForm organizationId="org-1" accounts={[]} />
      </BookClockProvider>,
    );
    expect(screen.getByDisplayValue("2026-10-17")).toBeInTheDocument();
  });

  it("notes a timezone change on anything covering an affected day", () => {
    render(
      <BookClockProvider timeZone="Europe/Berlin" changes={[change]}>
        <TimezoneChangeNotice from="2026-10-01" to="2026-10-17" />
      </BookClockProvider>,
    );
    expect(screen.getByRole("note")).toHaveTextContent(
      "This book’s timezone changed from America/Chicago to Europe/Berlin on Oct 18, 2026. Anything dated Oct 17, 2026 – Oct 18, 2026 may have been dated by either clock.",
    );
  });

  it("says nothing for ranges that miss the affected days", () => {
    render(
      <BookClockProvider timeZone="Europe/Berlin" changes={[change]}>
        <TimezoneChangeNotice from="2026-10-19" to="2026-10-31" />
      </BookClockProvider>,
    );
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("shows the notice on a form whose date falls on an affected day", () => {
    render(
      <BookClockProvider timeZone="America/Chicago" changes={[change]}>
        <JournalEntryForm organizationId="org-1" accounts={[]} />
      </BookClockProvider>,
    );
    expect(screen.getByRole("note")).toBeInTheDocument();
  });
});
