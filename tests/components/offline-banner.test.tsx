import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
      created_at: new Date().toISOString(),
    });

    render(<OfflineBanner />);

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/syncing 1 offline entry/i);
    });
  });
});
