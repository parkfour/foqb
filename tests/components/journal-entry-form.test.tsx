import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { JournalEntryForm } from "@/components/transactions/journal-entry-form";
import { db } from "@/lib/db/offline";

const { useOnlineStatusMock } = vi.hoisted(() => ({ useOnlineStatusMock: vi.fn() }));

vi.mock("@/components/providers/online-status-provider", () => ({
  useOnlineStatus: useOnlineStatusMock,
}));

const accounts = [
  { id: "acc-1", account_number: "1000", name: "Cash" },
  { id: "acc-2", account_number: "4000", name: "Revenue" },
];

beforeEach(async () => {
  await db.offline_entries.clear();
  vi.unstubAllGlobals();
});

afterEach(() => {
  cleanup();
});

function fillBalancedEntry() {
  const selects = screen.getAllByRole("combobox");
  fireEvent.change(selects[0], { target: { value: "acc-1" } });
  fireEvent.change(selects[1], { target: { value: "acc-2" } });

  fireEvent.change(screen.getAllByPlaceholderText("Debit")[0], { target: { value: "100" } });
  fireEvent.change(screen.getAllByPlaceholderText("Credit")[1], { target: { value: "100" } });
}

describe("JournalEntryForm", () => {
  it("shows an error when fewer than two lines have an account selected", () => {
    useOnlineStatusMock.mockReturnValue(true);
    render(<JournalEntryForm organizationId="org-1" accounts={accounts} />);

    fireEvent.click(screen.getByRole("button", { name: "Post Entry" }));

    expect(screen.getByText(/add at least two lines/i)).toBeInTheDocument();
  });

  it("shows an error when debits don't equal credits", () => {
    useOnlineStatusMock.mockReturnValue(true);
    render(<JournalEntryForm organizationId="org-1" accounts={accounts} />);

    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "acc-1" } });
    fireEvent.change(selects[1], { target: { value: "acc-2" } });
    fireEvent.change(screen.getAllByPlaceholderText("Debit")[0], { target: { value: "100" } });
    fireEvent.change(screen.getAllByPlaceholderText("Credit")[1], { target: { value: "90" } });

    fireEvent.click(screen.getByRole("button", { name: "Post Entry" }));

    expect(screen.getByText(/total debits must equal total credits/i)).toBeInTheDocument();
  });

  it("posts to the API when online with a balanced entry", async () => {
    useOnlineStatusMock.mockReturnValue(true);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, id: "entry-1" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<JournalEntryForm organizationId="org-1" accounts={accounts} />);
    fillBalancedEntry();

    fireEvent.click(screen.getByRole("button", { name: "Post Entry" }));

    await waitFor(() => {
      expect(screen.getByText("Entry posted")).toBeInTheDocument();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/journal-entries");
    expect(options.method).toBe("POST");

    const body = JSON.parse(options.body as string) as unknown;
    expect(body).toEqual({
      organization_id: "org-1",
      entry_date: expect.any(String),
      memo: "",
      lines: [
        { account_id: "acc-1", debit: 100, credit: 0 },
        { account_id: "acc-2", debit: 0, credit: 100 },
      ],
    });
  });

  it("saves to the offline store when offline", async () => {
    useOnlineStatusMock.mockReturnValue(false);
    render(<JournalEntryForm organizationId="org-1" accounts={accounts} />);
    fillBalancedEntry();

    expect(screen.getByRole("button", { name: "Save Offline" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save Offline" }));

    await waitFor(() => {
      expect(screen.getByText(/saved offline/i)).toBeInTheDocument();
    });

    const entries = await db.offline_entries.toArray();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      organization_id: "org-1",
      synced: false,
      lines: [
        { account_id: "acc-1", debit: 100, credit: 0 },
        { account_id: "acc-2", debit: 0, credit: 100 },
      ],
    });
  });
});
