import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { PersonalWealthDashboard } from "@/components/dashboard/personal-wealth-dashboard";
import type { NetWorthSnapshotData } from "@/lib/net-worth/engine";
import { addDays, isMonthEnd } from "@/lib/time/book-time";

// jsdom has <dialog> but not its modal methods.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

afterEach(cleanup);

const data: NetWorthSnapshotData = {
  organizationId: "org-1",
  date: "2026-10-20",
  totalAssets: 1250,
  totalLiabilities: 300,
  netWorth: 950,
  breakdown: { cash: 1000, investments: 0, real_estate: 250, vehicles: 0, credit_cards: 300, mortgages: 0, loans: 0, other_liabilities: 0 },
  items: [
    { bucket: "cash", name: "Savings ••1111", amount: 1200, href: "/reports/account/a1?from=networth" },
    { bucket: "cash", name: "Checking ••2222", amount: -200, href: "/reports/account/a2?from=networth" },
    { bucket: "real_estate", name: "Cabin", amount: 250, href: "/properties" },
    { bucket: "credit_cards", name: "Visa ••3333", amount: 300, href: "/reports/account/a3?from=networth" },
  ],
};

function dialog() {
  return within(screen.getByRole("dialog", { hidden: true }));
}

describe("PersonalWealthDashboard", () => {
  it("lists a row's accounts, each linked to its ledger", () => {
    render(<PersonalWealthDashboard data={data} history={[]} />);
    fireEvent.click(screen.getByText("Cash & Equivalents"));

    expect(dialog().getByRole("heading", { name: "Cash & Equivalents", hidden: true })).toBeInTheDocument();
    expect(dialog().getByText("Savings ••1111").closest("a")).toHaveAttribute("href", "/reports/account/a1?from=networth");
    expect(dialog().getByText("-$200.00")).toBeInTheDocument();
    expect(dialog().queryByText("Visa ••3333")).toBeNull();
  });

  it("splits net worth into assets and liabilities, and closes", () => {
    render(<PersonalWealthDashboard data={data} history={[]} />);
    fireEvent.click(screen.getByText("Total Net Worth"));

    expect(dialog().getByText("Assets $1,250.00")).toBeInTheDocument();
    expect(dialog().getByText("Liabilities $300.00")).toBeInTheDocument();
    expect(dialog().getByText("Cabin").closest("a")).toHaveAttribute("href", "/properties");
    expect(dialog().getByText("Visa ••3333")).toBeInTheDocument();

    fireEvent.click(dialog().getByRole("button", { name: "Close", hidden: true }));
    expect(screen.getByRole("dialog", { hidden: true })).not.toHaveAttribute("open");
  });

  it("counts businesses into assets only when they're included", () => {
    const businessEquity = { total: 5000, businesses: [{ id: "b1", name: "Shop LLC", equity: 5000, currency: "USD", ownEquity: 5000 }] };
    render(<PersonalWealthDashboard data={data} history={[]} businessEquity={businessEquity} />);
    fireEvent.click(screen.getByText("Total Assets"));
    expect(dialog().queryByText("Shop LLC (business equity)")).toBeNull();
    fireEvent.click(dialog().getByRole("button", { name: "Close", hidden: true }));

    fireEvent.click(screen.getByLabelText("Include in Net Worth"));
    fireEvent.click(screen.getByText("Total Assets"));
    expect(dialog().getByText("Shop LLC (business equity)")).toBeInTheDocument();
  });

  it("adds a book in another currency at its quote, marked, and lists one without a quote as left out", () => {
    const quote = { rate: 0.00075, asOf: "2026-10-23", source: "European Central Bank reference rate" };
    const businessEquity = {
      total: 750,
      businesses: [
        { id: "k1", name: "Seoul Co", equity: 750, currency: "KRW", ownEquity: 1_000_000, quote },
        { id: "e1", name: "Berlin GmbH", equity: null, currency: "EUR", ownEquity: 2000 },
      ],
    };
    render(<PersonalWealthDashboard data={data} history={[]} businessEquity={businessEquity} />);

    expect(screen.getByText("≈ $750.00")).toBeInTheDocument();
    expect(screen.getByText(/at 0.00075 \(2026-10-23\)/)).toBeInTheDocument();
    expect(screen.getByText(/not included, no exchange rate/)).toBeInTheDocument();
    expect(screen.getByText(/1 business kept in another currency isn.t included/)).toBeInTheDocument();
    expect(screen.getByText(/an estimate,\s+not recorded in any book/)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Include in Net Worth"));
    fireEvent.click(screen.getByText("Total Assets"));
    expect(dialog().getByText("Seoul Co (business equity, ≈ from KRW)")).toBeInTheDocument();
    expect(dialog().queryByText(/Berlin GmbH/)).toBeNull();
  });

  it("greys out a suspended business and leaves it out of the total", () => {
    const businessEquity = {
      total: 5000,
      businesses: [
        { id: "b1", name: "Shop LLC", equity: 5000, currency: "USD", ownEquity: 5000 },
        { id: "s1", name: "Dormant Co", equity: null, currency: "USD", ownEquity: 9000, suspended: true },
      ],
    };
    render(<PersonalWealthDashboard data={data} history={[]} businessEquity={businessEquity} />);

    expect(screen.getByText(/suspended, not included/)).toBeInTheDocument();
    expect(screen.getByText("Dormant Co").parentElement?.parentElement).toHaveClass("opacity-50");
    expect(screen.queryByText(/kept in another currency/)).toBeNull();

    fireEvent.click(screen.getByLabelText("Include in Net Worth"));
    fireEvent.click(screen.getByText("Total Assets"));
    expect(dialog().getByText("Shop LLC (business equity)")).toBeInTheDocument();
    expect(dialog().queryByText(/Dormant Co/)).toBeNull();
  });

  it("says what a suspended business booked after its books were closed", () => {
    const businessEquity = {
      total: 0,
      businesses: [
        {
          id: "s1",
          name: "Dormant Co",
          equity: null,
          currency: "USD",
          ownEquity: 9000,
          suspended: true,
          afterClose: { closedThrough: "2025-12-31", entries: 3, equityChange: -250 },
        },
      ],
    };
    render(<PersonalWealthDashboard data={data} history={[]} businessEquity={businessEquity} />);

    expect(screen.getByText(/After the books closed on 2025-12-31: 3 entries, -\$250\.00 equity/)).toBeInTheDocument();
  });

  it("draws daily points for 1M and 6M, and month-ends with today for 1Y and All-time", () => {
    // As fetchNetWorthHistory gives it: month-ends from June 2024, then every
    // day of the last six months, through today (2026-10-20).
    const dates = new Set<string>();
    for (let d = "2024-06-01"; d <= data.date; d = addDays(d, 1)) {
      if (isMonthEnd(d) || d >= "2026-04-20") dates.add(d);
    }
    const history = [...dates].map((date, i) => ({ date, net_worth: i, total_assets: i, total_liabilities: 0 }));
    render(<PersonalWealthDashboard data={data} history={history} />);
    const drawn = () => [...document.querySelectorAll("svg path title")].map((t) => (t.textContent ?? "").split(":")[0]);

    // 1Y, the default: the month-ends of the last year, then today.
    expect(drawn()).toEqual([
      "2025-10-31", "2025-11-30", "2025-12-31", "2026-01-31", "2026-02-28", "2026-03-31",
      "2026-04-30", "2026-05-31", "2026-06-30", "2026-07-31", "2026-08-31", "2026-09-30", "2026-10-20",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "6M" }));
    expect(drawn()[0]).toBe("2026-04-23");
    expect(drawn()).toHaveLength(181);

    fireEvent.click(screen.getByRole("button", { name: "1M" }));
    expect(drawn()[0]).toBe("2026-09-20");
    expect(drawn()).toHaveLength(31);

    fireEvent.click(screen.getByRole("button", { name: "All-time" }));
    expect(drawn()[0]).toBe("2024-06-30");
    expect(drawn().every((d) => isMonthEnd(d) || d === data.date)).toBe(true);
  });
});
