import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/app/(dashboard)/between-books/actions", () => ({ postBetweenBooks: vi.fn() }));

import { BetweenBooksForm, type BookOption } from "@/components/between-books/between-books-form";

afterEach(() => {
  cleanup();
});

const book = (id: string, name: string): BookOption => ({
  id,
  name,
  currency: "USD",
  accounts: [{ id: `${id}-cash`, account_number: "1000", name: "Cash", type: "asset" }],
  bankTransactions: [],
});

describe("BetweenBooksForm", () => {
  it("keeps the browser from restoring stale values, and its kind radios exclusive", () => {
    const { container } = render(
      <BetweenBooksForm thisBookId="biz" books={[book("biz", "Business"), book("home", "Household")]} today="2026-11-27" showAccountCodes />,
    );

    expect(container.querySelector("form")).toHaveAttribute("autocomplete", "off");
    const radios = screen.getAllByRole("radio");
    expect(new Set(radios.map((r) => r.getAttribute("name")))).toEqual(new Set(["kindChoice"]));

    fireEvent.click(radios[0]);
    expect(radios.filter((r) => (r as HTMLInputElement).checked)).toHaveLength(1);
    expect(container.querySelector('input[name="kind"]')).toHaveValue("transfer");
  });
});
