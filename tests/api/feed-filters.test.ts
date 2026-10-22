import { describe, expect, it } from "vitest";
import { containsPattern, feedHref, parseFeedFilters } from "@/lib/bank/feed-filters";

const ACCOUNT = "85ee774f-2bd1-4224-b368-8974231d7344";

describe("Bank Transactions filters", () => {
  it("reads the search, account, status and page from the URL, ignoring what isn't one", () => {
    expect(parseFeedFilters({ q: "  coffee ", account: ACCOUNT, status: "ignored", page: "3" })).toEqual({
      search: "coffee",
      account: ACCOUNT,
      status: "ignored",
      page: 3,
      isFiltered: true,
    });
    expect(parseFeedFilters({ account: "not-an-id", status: "deleted", page: "-2" })).toEqual({
      search: "",
      account: undefined,
      status: undefined,
      page: 1,
      isFiltered: false,
    });
    expect(parseFeedFilters({ page: "2.7" }).page).toBe(2);
  });

  it("takes a search's own % and _ literally", () => {
    expect(containsPattern("100%_off\\")).toBe("%100\\%\\_off\\\\%");
  });

  it("keeps the filters when paging, and drops what's empty", () => {
    expect(feedHref({ q: "coffee", account: ACCOUNT, status: "" }, { page: "2" })).toBe(
      `/transactions?q=coffee&account=${ACCOUNT}&page=2`,
    );
    expect(feedHref({}, {})).toBe("/transactions");
  });
});
