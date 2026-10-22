import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const { countUncategorized } = vi.hoisted(() => ({ countUncategorized: vi.fn() }));
vi.mock("@/app/(dashboard)/transactions/actions", () => ({ countUncategorized }));

import { UncategorizedToast } from "@/components/layout/uncategorized-toast";

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  localStorage.clear();
  countUncategorized.mockResolvedValue(3);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("UncategorizedToast", () => {
  it("says how many are waiting on a first visit, and can be dismissed", async () => {
    render(<UncategorizedToast />);
    expect(await screen.findByText("3 transactions are waiting to be categorized")).toHaveAttribute("href", "/register");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("stays quiet when nothing is waiting", async () => {
    countUncategorized.mockResolvedValue(0);
    render(<UncategorizedToast />);
    await act(async () => {});
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("checks again only after the tab was away for a while", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-22T09:00:00Z"));
    localStorage.setItem("foqb:last-seen", String(Date.now()));
    render(<UncategorizedToast />);
    expect(countUncategorized).not.toHaveBeenCalled();

    setVisibility("hidden");
    vi.setSystemTime(new Date("2026-10-22T09:10:00Z"));
    setVisibility("visible");
    expect(countUncategorized).not.toHaveBeenCalled();

    setVisibility("hidden");
    vi.setSystemTime(new Date("2026-10-22T10:00:00Z"));
    setVisibility("visible");
    expect(countUncategorized).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("status")).toBeInTheDocument();
  });
});
