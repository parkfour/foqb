import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { PersonalWealthDashboard } from "@/components/dashboard/personal-wealth-dashboard";
import type { NetWorthSnapshotData } from "@/lib/net-worth/engine";

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
    const businessEquity = { total: 5000, businesses: [{ id: "b1", name: "Shop LLC", equity: 5000 }] };
    render(<PersonalWealthDashboard data={data} history={[]} businessEquity={businessEquity} />);
    fireEvent.click(screen.getByText("Total Assets"));
    expect(dialog().queryByText("Shop LLC (business equity)")).toBeNull();
    fireEvent.click(dialog().getByRole("button", { name: "Close", hidden: true }));

    fireEvent.click(screen.getByLabelText("Include in Net Worth"));
    fireEvent.click(screen.getByText("Total Assets"));
    expect(dialog().getByText("Shop LLC (business equity)")).toBeInTheDocument();
  });
});
