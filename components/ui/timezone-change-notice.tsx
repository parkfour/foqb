"use client";

import { useBookClock } from "@/components/providers/book-clock-provider";
import { changesOverlapping, formatTimestampDate } from "@/lib/time/book-time";

function day(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Shown on anything covering a day the book's timezone change made
// ambiguous: items dated then may have been dated by either clock.
export function TimezoneChangeNotice({ from, to = from }: { from: string | null | undefined; to?: string | null }) {
  const { timeZone, changes } = useBookClock();
  if (!from || !to) return null;

  const overlapping = changesOverlapping(changes, from <= to ? from : to, from <= to ? to : from);
  if (overlapping.length === 0) return null;

  return (
    <div role="note" className="mb-4 rounded-md bg-amber-100 px-4 py-2 text-sm text-amber-900">
      {overlapping.map((c) => (
        <p key={c.changedAt}>
          This book&rsquo;s timezone changed from {c.oldTimezone} to {c.newTimezone} on{" "}
          {formatTimestampDate(c.changedAt, timeZone)}. Anything dated{" "}
          {c.firstAffected === c.lastAffected ? day(c.firstAffected) : `${day(c.firstAffected)} – ${day(c.lastAffected)}`}{" "}
          may have been dated by either clock.
        </p>
      ))}
    </div>
  );
}
