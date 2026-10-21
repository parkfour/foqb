import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { isValidTimezone, localDate, type TimezoneChange } from "@/lib/time/book-time";

// What an organization with no timezone of its own uses.
export function instanceTimezone(): string {
  const configured = process.env.DEFAULT_TIMEZONE?.trim();
  return isValidTimezone(configured) ? configured : "UTC";
}

export interface BookClock {
  timeZone: string;
  // True when the book follows the instance default rather than its own.
  usesInstanceDefault: boolean;
  changes: TimezoneChange[];
}

// Once per request per organization.
export const getBookClock = cache(async (orgId: string | null): Promise<BookClock> => {
  if (!orgId) return { timeZone: instanceTimezone(), usesInstanceDefault: true, changes: [] };

  const supabase = await createClient();
  const [{ data: org }, { data: changes }] = await Promise.all([
    supabase.from("organizations").select("timezone").eq("id", orgId).maybeSingle(),
    supabase
      .from("organization_timezone_changes")
      .select("changed_at, old_timezone, new_timezone, first_affected, last_affected")
      .eq("organization_id", orgId)
      .order("changed_at"),
  ]);

  const own = (org as { timezone: string | null } | null)?.timezone ?? null;
  return {
    timeZone: own ?? instanceTimezone(),
    usesInstanceDefault: own === null,
    changes: ((changes ?? []) as {
      changed_at: string;
      old_timezone: string;
      new_timezone: string;
      first_affected: string;
      last_affected: string;
    }[]).map((c) => ({
      changedAt: c.changed_at,
      oldTimezone: c.old_timezone,
      newTimezone: c.new_timezone,
      firstAffected: c.first_affected,
      lastAffected: c.last_affected,
    })),
  };
});

// Today's date in the organization's timezone.
export async function bookToday(orgId: string | null): Promise<string> {
  return localDate((await getBookClock(orgId)).timeZone);
}
