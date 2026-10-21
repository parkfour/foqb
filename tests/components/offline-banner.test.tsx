import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OfflineBanner } from "@/components/ui/offline-banner";
import { db } from "@/lib/db/offline";

const { useOnlineStatusMock } = vi.hoisted(() => ({ useOnlineStatusMock: vi.fn() }));

vi.mock("@/components/providers/online-status-provider", () => ({
  useOnlineStatus: useOnlineStatusMock,
}));

beforeEach(async () => {
  await db.offline_entries.clear();
});

afterEach(() => {
  cleanup();
});

describe("OfflineBanner", () => {
  it("renders nothing when online with no pending entries", () => {
    useOnlineStatusMock.mockReturnValue(true);
    render(<OfflineBanner />);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows the offline message when offline", () => {
    useOnlineStatusMock.mockReturnValue(false);
    render(<OfflineBanner />);

    expect(screen.getByRole("status")).toHaveTextContent(/you're offline/i);
  });

  it("shows a syncing message with the live unsynced count while online", async () => {
    useOnlineStatusMock.mockReturnValue(true);

    await db.offline_entries.add({
      organization_id: "org-1",
      entry_date: "2026-01-01",
      memo: "Test",
      lines: [],
      synced: false,
      status: "pending",
      created_at: new Date().toISOString(),
    });

    render(<OfflineBanner />);

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/syncing 1 offline entry/i);
    });
  });

  it("lists each failed entry with its reason and dismisses only the one clicked", async () => {
    useOnlineStatusMock.mockReturnValue(true);

    for (const memo of ["Locked period entry", "Second entry"]) {
      await db.offline_entries.add({
        organization_id: "org-1",
        entry_date: "2026-01-01",
        memo,
        lines: [],
        synced: false,
        status: "failed",
        error_message: "entry_date falls within a locked period",
        created_at: new Date().toISOString(),
      });
    }

    render(<OfflineBanner />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/2 entries saved offline could not be posted/i);
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "2026-01-01 Locked period entry: entry_date falls within a locked period",
    );

    fireEvent.click(screen.getAllByRole("button", { name: /dismiss/i })[0]);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/an entry saved offline could not be posted/i);
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Second entry");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
