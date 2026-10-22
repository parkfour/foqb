import { describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach } from "vitest";
import { Sidebar } from "@/components/layout/sidebar";

const { usePathnameMock } = vi.hoisted(() => ({ usePathnameMock: vi.fn(() => "/") }));

vi.mock("next/navigation", () => ({
  usePathname: usePathnameMock,
}));

afterEach(() => {
  cleanup();
});

describe("Sidebar", () => {
  it("renders all nav links", () => {
    render(<Sidebar />);

    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Bank Transactions" })).toHaveAttribute(
      "href",
      "/transactions",
    );
    expect(screen.getByRole("link", { name: "Reconcile" })).toHaveAttribute("href", "/reconcile");
    expect(screen.getByRole("link", { name: "Chart of Accounts" })).toHaveAttribute(
      "href",
      "/accounts",
    );
    expect(screen.getByRole("link", { name: "Items" })).toHaveAttribute("href", "/items");
    expect(screen.getByRole("link", { name: "Fixed Assets" })).toHaveAttribute(
      "href",
      "/fixed-assets",
    );
    expect(screen.getByRole("link", { name: "Financial Reports" })).toHaveAttribute(
      "href",
      "/reports",
    );
    expect(screen.getByRole("link", { name: "Rules" })).toHaveAttribute("href", "/rules");
    expect(screen.getByRole("link", { name: "Audit Log" })).toHaveAttribute("href", "/audit-log");
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  });

  it("gives a household its register and Bank Transactions both", () => {
    render(<Sidebar workspaceType="household" />);

    expect(screen.getByRole("link", { name: "Register" })).toHaveAttribute("href", "/register");
    expect(screen.getByRole("link", { name: "Bank Transactions" })).toHaveAttribute("href", "/transactions");
  });

  it("hides the Inventory link by default and shows it when enabled", () => {
    render(<Sidebar />);
    expect(screen.queryByRole("link", { name: "Inventory" })).not.toBeInTheDocument();

    cleanup();

    render(<Sidebar showInventory />);
    expect(screen.getByRole("link", { name: "Inventory" })).toHaveAttribute("href", "/inventory");
  });

  it("starts groups collapsed and expands Customers on click to reveal its sub-links", () => {
    render(<Sidebar />);

    expect(screen.queryByRole("link", { name: "Invoice" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /customers/i }));

    expect(screen.getByRole("link", { name: "Add" })).toHaveAttribute("href", "/customers/new");
    expect(screen.getByRole("link", { name: "Edit" })).toHaveAttribute("href", "/customers");
    expect(screen.getByRole("link", { name: "Invoice" })).toHaveAttribute(
      "href",
      "/customers/invoices/new",
    );
    expect(screen.getByRole("link", { name: "Receive Payment" })).toHaveAttribute(
      "href",
      "/customers/payments/new",
    );
    expect(screen.getByRole("link", { name: "All Invoices" })).toHaveAttribute(
      "href",
      "/customers/invoices",
    );
    expect(screen.getByRole("link", { name: "Recurring Invoices" })).toHaveAttribute(
      "href",
      "/customers/recurring",
    );
  });

  it("expands Vendors on click to reveal its sub-links", () => {
    render(<Sidebar />);

    fireEvent.click(screen.getByRole("button", { name: /vendors/i }));

    expect(screen.getByRole("link", { name: "Add" })).toHaveAttribute("href", "/vendors/new");
    expect(screen.getByRole("link", { name: "Edit" })).toHaveAttribute("href", "/vendors");
    expect(screen.getByRole("link", { name: "Enter Invoice" })).toHaveAttribute(
      "href",
      "/vendors/bills/new",
    );
    expect(screen.getByRole("link", { name: "Make Payment" })).toHaveAttribute(
      "href",
      "/vendors/payments/new",
    );
    expect(screen.getByRole("link", { name: "All Bills" })).toHaveAttribute(
      "href",
      "/vendors/bills",
    );
    expect(screen.getByRole("link", { name: "Recurring Bills" })).toHaveAttribute(
      "href",
      "/vendors/recurring",
    );
  });

  it("auto-expands a group when the current path is under its prefix", () => {
    usePathnameMock.mockReturnValue("/customers/new");
    render(<Sidebar />);

    expect(screen.getByRole("link", { name: "Invoice" })).toHaveAttribute(
      "href",
      "/customers/invoices/new",
    );
  });

  it("marks the link matching the current path as active", () => {
    usePathnameMock.mockReturnValue("/accounts");
    render(<Sidebar />);

    const activeLink = screen.getByRole("link", { name: "Chart of Accounts" });
    const inactiveLink = screen.getByRole("link", { name: "Dashboard" });

    expect(activeLink.className).toContain("bg-slate-900");
    expect(inactiveLink.className).not.toContain("bg-slate-900");
  });

  it("opens the mobile drawer when the menu button is clicked", () => {
    usePathnameMock.mockReturnValue("/");
    render(<Sidebar />);

    const aside = screen.getByRole("link", { name: "Dashboard" }).closest("aside");
    expect(aside?.className).toContain("-translate-x-full");

    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));

    expect(aside?.className).toContain("translate-x-0");
    expect(aside?.className).not.toContain("-translate-x-full");
  });
});
