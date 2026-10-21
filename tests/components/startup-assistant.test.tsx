import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { getStartup, startBudget, finishStartup, cleanUpStartup } = vi.hoisted(() => ({
  getStartup: vi.fn(),
  startBudget: vi.fn(),
  finishStartup: vi.fn(),
  cleanUpStartup: vi.fn(),
}));
vi.mock("@/plugins/startup-assistant/actions", () => ({ getStartup, startBudget, finishStartup, cleanUpStartup }));

import { StartupAssistant } from "@/plugins/startup-assistant/startup-assistant";

const accounts = [{ accountId: "a1", name: "Checking ••1234", startsOn: "2025-12-31", earlyEntries: 0, earlyRows: 0 }];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("StartupAssistant", () => {
  it("asks a household about a starting budget, budgets the chosen months, then finishes", async () => {
    getStartup.mockResolvedValue({ accounts, budget: { from: "2026-01", to: "2026-09" } });
    startBudget.mockResolvedValue({ success: true, value: { accounts: 4, months: 6 } });
    finishStartup.mockResolvedValue({ success: true, value: null });
    render(<StartupAssistant context={{ accounts: [] }} />);

    fireEvent.click(await screen.findByRole("button", { name: "All done" }));
    expect(screen.getByText(/average spending, or no budget/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-04" } });
    fireEvent.click(screen.getByRole("button", { name: "Average spending" }));

    await waitFor(() => expect(finishStartup).toHaveBeenCalled());
    expect(startBudget).toHaveBeenCalledWith("2026-04", "2026-09");
    await waitFor(() => expect(screen.queryByText("Start-up assistant")).toBeNull());
  });

  it("finishes without a budget when asked for none", async () => {
    getStartup.mockResolvedValue({ accounts, budget: { from: "2026-01", to: "2026-09" } });
    finishStartup.mockResolvedValue({ success: true, value: null });
    render(<StartupAssistant context={{ accounts: [] }} />);

    fireEvent.click(await screen.findByRole("button", { name: "All done" }));
    fireEvent.click(screen.getByRole("button", { name: "No budget" }));

    await waitFor(() => expect(finishStartup).toHaveBeenCalled());
    expect(startBudget).not.toHaveBeenCalled();
  });

  it("finishes a business book straight away, and stays open if budgeting fails", async () => {
    getStartup.mockResolvedValue({ accounts, budget: null });
    finishStartup.mockResolvedValue({ success: true, value: null });
    render(<StartupAssistant context={{ accounts: [] }} />);
    fireEvent.click(await screen.findByRole("button", { name: "All done" }));
    await waitFor(() => expect(finishStartup).toHaveBeenCalled());
    expect(screen.queryByText(/no budget/)).toBeNull();
    cleanup();
    vi.clearAllMocks();

    getStartup.mockResolvedValue({ accounts, budget: { from: "2026-01", to: "2026-09" } });
    startBudget.mockResolvedValue({ success: false, error: "At most 36 months" });
    render(<StartupAssistant context={{ accounts: [] }} />);
    fireEvent.click(await screen.findByRole("button", { name: "All done" }));
    fireEvent.click(screen.getByRole("button", { name: "Average spending" }));
    expect(await screen.findByRole("status")).toHaveProperty("textContent", "At most 36 months");
    expect(finishStartup).not.toHaveBeenCalled();
  });
});
