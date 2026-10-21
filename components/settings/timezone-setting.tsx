"use client";

import { useMemo, useState } from "react";
import { setOrganizationTimezone } from "@/app/(dashboard)/settings/actions";
import { localDate } from "@/lib/time/book-time";

interface TimezoneSettingProps {
  organizationId: string;
  timeZone: string;
  usesInstanceDefault: boolean;
  isOwner: boolean;
}

function allTimezones(current: string): string[] {
  const zones = Intl.supportedValuesOf?.("timeZone") ?? [];
  return zones.includes(current) ? zones : [current, ...zones];
}

export function TimezoneSetting({ organizationId, timeZone, usesInstanceDefault, isOwner }: TimezoneSettingProps) {
  const [selected, setSelected] = useState(timeZone);
  const zones = useMemo(() => allTimezones(timeZone), [timeZone]);

  const description = (
    <p className="text-xs text-slate-500">
      Decides what &ldquo;today&rdquo; is for this book: default dates, month-to-date and &ldquo;as of
      today&rdquo; figures, and when recurring items are due. Dates already entered never change.
      {usesInstanceDefault && " It currently follows this instance's default."}
    </p>
  );

  if (!isOwner) {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-slate-700">Timezone: {timeZone}</p>
        {description}
      </div>
    );
  }

  const changing = selected !== timeZone;
  const before = localDate(timeZone);
  const after = localDate(selected);
  const first = before <= after ? before : after;
  const last = before <= after ? after : before;

  return (
    <form action={setOrganizationTimezone} className="flex flex-col gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <label htmlFor="timezone" className="text-sm font-medium text-slate-700">
        Timezone
      </label>
      {description}
      <select
        id="timezone"
        name="timezone"
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        className="w-fit rounded-md border border-slate-300 px-3 py-2 text-sm"
      >
        {zones.map((zone) => (
          <option key={zone} value={zone}>
            {zone}
          </option>
        ))}
      </select>

      {changing && (
        <div className="flex flex-col gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
          <p>
            Right now it&rsquo;s {before} in {timeZone} and {after} in {selected}. Switching moves where
            this book&rsquo;s day begins, so anything dated {first === last ? first : `${first} to ${last}`}{" "}
            may have been dated by either clock. Reports, lists and forms covering{" "}
            {first === last ? "that day" : "those days"} will say so.
          </p>
          <label className="flex items-center gap-2">
            <input type="checkbox" required />I understand; change the timezone.
          </label>
          <button
            type="submit"
            className="w-fit rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Change timezone
          </button>
        </div>
      )}
    </form>
  );
}
