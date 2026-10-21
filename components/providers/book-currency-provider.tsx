"use client";

import { createContext, useCallback, useContext, type ReactNode } from "react";
import { formatMoney } from "@/lib/money";

const BookCurrencyContext = createContext("USD");

// The current book's currency, for client components.
export function BookCurrencyProvider({ currency, children }: { currency: string; children: ReactNode }) {
  return <BookCurrencyContext.Provider value={currency}>{children}</BookCurrencyContext.Provider>;
}

export function useBookCurrency(): string {
  return useContext(BookCurrencyContext);
}

// Formats an amount in the book's currency.
export function useMoney(): (value: number) => string {
  const currency = useBookCurrency();
  return useCallback((value: number) => formatMoney(value, currency), [currency]);
}
