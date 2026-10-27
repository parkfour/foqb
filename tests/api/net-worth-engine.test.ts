import { describe, expect, it } from "vitest";
import { createSupabaseMock, ok } from "./supabase-mock";
import { calculateHouseholdNetWorth, fetchNetWorthHistory, historyDates, withTodaysPoint } from "@/lib/net-worth/engine";

const row = (name: string, type: string, balance: number, account_number = "2000") => ({
  account_id: `id-${name}`,
  account_number,
  name,
  type,
  balance,
});

describe("calculateHouseholdNetWorth", () => {
  it("counts a bank-fed account its name doesn't explain as cash, or a credit card if owed", async () => {
    const { client } = createSupabaseMock({
      rpcs: {
        get_balance_sheet: ok([
          row("Bank home", "asset", 400),
          row("Bank Sacings", "asset", 600),
          row("Airline", "liability", 70),
          row("Brokerage ••1234", "asset", 900),
          row("Fidelity 403(b) ••5678", "asset", 100),
          row("Car loan", "liability", 8000),
          row("Family home", "asset", 300000),
          row("IOU to a friend", "liability", 50),
        ]),
      },
      tables: {
        properties: { select: ok([]) },
        accounts: {
          select: ok([{ id: "id-Bank home" }, { id: "id-Bank Sacings" }, { id: "id-Airline" }, { id: "id-Brokerage ••1234" }, { id: "id-Fidelity 403(b) ••5678" }, { id: "id-Car loan" }]),
        },
        net_worth_snapshots: { select: ok(null), upsert: ok(null) },
        investment_trades: { select: ok([]) },
        securities: { select: ok([]) },
        security_prices: { select: ok([]) },
      },
    });

    const { breakdown } = await calculateHouseholdNetWorth("org-1", "2026-10-17", client as never);

    expect(breakdown).toMatchObject({
      cash: 1000,
      investments: 1000,
      real_estate: 300000,
      credit_cards: 70,
      loans: 8000,
      other_liabilities: 50,
    });
  });

  it("counts an account with holdings at market value, in investments whatever its name", async () => {
    const { client } = createSupabaseMock({
      rpcs: { get_balance_sheet: ok([row("Schwab ••99", "asset", 2005)]) },
      tables: {
        properties: { select: ok([]) },
        accounts: { select: ok([]) },
        net_worth_snapshots: { select: ok(null), upsert: ok(null) },
        investment_trades: {
          select: ok([{ account_id: "id-Schwab ••99", security_id: "vti", trade_date: "2026-01-02", kind: "buy", quantity: 10, price: 200, fees: 5 }]),
        },
        securities: { select: ok([{ id: "vti", symbol: "VTI", name: null }]) },
        security_prices: { select: ok([{ security_id: "vti", price_date: "2026-10-16", price: 250 }]) },
      },
    });

    const { breakdown } = await calculateHouseholdNetWorth("org-1", "2026-10-17", client as never);

    // Cost 2,005, worth 2,500.
    expect(breakdown).toMatchObject({ cash: 0, investments: 2500 });
  });

  it("buckets balances by account name, keeps overdrafts negative, and adds properties", async () => {
    const { client } = createSupabaseMock({
      rpcs: {
        get_balance_sheet: ok([
          row("Checking", "asset", -50, "1010"),
          row("Savings", "asset", 1000, "1020"),
          row("Roth IRA", "asset", 5000),
          row("Childcare fund", "asset", 200),
          row("Visa credit card", "liability", 300),
          row("Home mortgage", "liability", 100000),
          row("Car loan", "liability", 8000),
          { account_id: null, account_number: null, name: "Retained earnings", type: "equity", balance: 999 },
        ]),
      },
      tables: {
        properties: {
          select: ok([
            { name: "Lake house", estimated_value: 250000, purchase_price: 200000 },
            { name: "Lot", estimated_value: null, purchase_price: 90000 },
            { name: "Coin collection", kind: "other", estimated_value: 12000, purchase_price: 8000 },
          ]),
        },
        accounts: { select: ok([]) },
        net_worth_snapshots: { select: ok(null), upsert: ok(null) },
        investment_trades: { select: ok([]) },
        securities: { select: ok([]) },
        security_prices: { select: ok([]) },
      },
    });

    const result = await calculateHouseholdNetWorth("org-1", "2026-10-17", client as never);

    expect(result.breakdown).toEqual({
      cash: 950,
      investments: 5000,
      real_estate: 340000,
      vehicles: 12200, // Other assets: the coin collection, and "Childcare fund", an asset account it can't place
      credit_cards: 300,
      mortgages: 100000,
      loans: 8000,
      other_liabilities: 0,
    });
    expect(result.totalAssets).toBe(358150);
    expect(result.totalLiabilities).toBe(108300);
    expect(result.netWorth).toBe(249850);
    // What's in each figure, biggest first, each linked to where it's kept.
    expect(result.items?.filter((i) => i.bucket === "cash")).toEqual([
      { bucket: "cash", name: "Savings", amount: 1000, href: "/reports/account/id-Savings?from=networth" },
      { bucket: "cash", name: "Checking", amount: -50, href: "/reports/account/id-Checking?from=networth" },
    ]);
    expect(result.items?.filter((i) => i.bucket === "real_estate").map((i) => [i.name, i.amount, i.href])).toEqual([
      ["Lake house", 250000, "/properties"],
      ["Lot", 90000, "/properties"],
    ]);
    expect(result.items?.find((i) => i.name === "Car loan")?.bucket).toBe("loans");
  });
});

describe("withTodaysPoint", () => {
  it("replaces a stale stored point for today with the live figures", () => {
    const history = [
      { date: "2026-10-11", net_worth: 100, total_assets: 150, total_liabilities: 50 },
      { date: "2026-10-18", net_worth: 0, total_assets: 0, total_liabilities: 0 },
    ];
    const today = {
      organizationId: "org",
      date: "2026-10-18",
      totalAssets: 160,
      totalLiabilities: 50,
      netWorth: 110,
      breakdown: { cash: 0, investments: 0, real_estate: 0, vehicles: 0, credit_cards: 0, mortgages: 0, loans: 0 },
    };

    expect(withTodaysPoint(history, today)).toEqual([
      history[0],
      { date: "2026-10-18", net_worth: 110, total_assets: 160, total_liabilities: 50 },
    ]);
  });
});

describe("historyDates", () => {
  it("asks for each month-end from the first entry, then every day of the last six months, through today", () => {
    const dates = historyDates("2025-01-15", "2026-10-22");

    expect(dates[0]).toBe("2025-01-31");
    expect(dates).toContain("2025-02-28");
    expect(dates).toContain("2026-03-31");
    expect(dates).not.toContain("2025-06-15");
    expect(dates).toContain("2026-04-22"); // 183 days back: daily from here
    expect(dates).toContain("2026-10-21");
    expect(dates.at(-1)).toBe("2026-10-22");
    expect(new Set(dates).size).toBe(dates.length);
    expect([...dates].sort()).toEqual(dates);
  });

  it("starts no earlier than the first entry", () => {
    expect(historyDates("2026-10-20", "2026-10-22")).toEqual(["2026-10-20", "2026-10-21", "2026-10-22"]);
  });
});

describe("fetchNetWorthHistory", () => {
  it("adds a property's value from its purchase date on to what the ledger holds", async () => {
    const { client } = createSupabaseMock({
      rpcs: {
        get_net_worth_series: ok([
          { as_of: "2026-08-31", total_assets: "1000", total_liabilities: "200" },
          { as_of: "2026-09-30", total_assets: "1500", total_liabilities: "200" },
        ]),
      },
      tables: {
        journal_entries: { select: ok({ entry_date: "2026-08-02" }) },
        properties: {
          select: ok([{ estimated_value: 300000, purchase_price: 250000, purchase_date: "2026-09-15" }]),
        },
      },
    });

    expect(await fetchNetWorthHistory("org-1", "2026-10-22", client as never)).toEqual([
      { date: "2026-08-31", net_worth: 800, total_assets: 1000, total_liabilities: 200 },
      { date: "2026-09-30", net_worth: 301300, total_assets: 301500, total_liabilities: 200 },
    ]);
  });

  it("has no history before anything's booked", async () => {
    const { client } = createSupabaseMock({
      tables: { journal_entries: { select: ok(null) }, properties: { select: ok([]) } },
    });

    expect(await fetchNetWorthHistory("org-1", "2026-10-22", client as never)).toEqual([]);
  });
});
