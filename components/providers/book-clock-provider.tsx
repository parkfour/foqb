"use client";

import { createContext, useContext, type ReactNode } from "react";
import { localDate, type TimezoneChange } from "@/lib/time/book-time";

interface BookClockValue {
  timeZone: string;
  changes: TimezoneChange[];
}

const BookClockContext = createContext<BookClockValue>({ timeZone: "UTC", changes: [] });

// The current book's timezone, for client components: forms default to the
// book's date, not the device's.
export function BookClockProvider({ timeZone, changes, children }: BookClockValue & { children: ReactNode }) {
  return <BookClockContext.Provider value={{ timeZone, changes }}>{children}</BookClockContext.Provider>;
}

export function useBookClock(): BookClockValue {
  return useContext(BookClockContext);
}

export function useBookToday(): string {
  return localDate(useBookClock().timeZone);
}
