import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { readLines, importMock, createAccountMock } = vi.hoisted(() => ({
  readLines: vi.fn(),
  importMock: vi.fn(),
  createAccountMock: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/plugins/statement-import/read-statement", () => ({ readStatementLines: readLines }));
vi.mock("@/plugins/statement-import/actions", () => ({ importStatementAction: importMock }));
vi.mock("@/app/(dashboard)/accounts/actions", () => ({ createAccountQuickAction: createAccountMock }));

import { StatementImporter } from "@/plugins/statement-import/statement-importer";

// A made-up Capital One statement for an account the book doesn't have.
const statement = [
  "capitalone.com",
  "Sep 1 - Sep 30, 2026",
  "Rainy Day Savings - 36100005555",
  "Sep 1 | Opening Balance | $100.00",
  "Sep 2 | Deposit | Credit | + $50.00 | $150.00",
  "Sep 30 | Closing Balance | $150.00",
];

const accounts = [{ id: "acc-checking", name: "360 Checking ••4321", account_number: "1201", type: "asset" }];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("StatementImporter", () => {
  it("offers to create the account a statement is for, then imports into it", async () => {
    readLines.mockResolvedValue(statement);
    createAccountMock.mockResolvedValue({
      success: true,
      account: { id: "acc-new", name: "Rainy Day Savings ••5555", account_number: "1205", type: "asset" },
    });
    importMock.mockResolvedValue({ success: true, added: 1, alreadyThere: 0, uncategorized: 1, reconciled: false });
    render(<StatementImporter context={{ accounts }} />);

    const file = new File(["%PDF"], "statement.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("Statement PDF"), { target: { files: [file] } });

    expect(await screen.findByLabelText("Into")).toHaveValue("__new__");
    expect(screen.getByLabelText("New account name")).toHaveValue("Rainy Day Savings ••5555");
    fireEvent.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() => expect(createAccountMock).toHaveBeenCalledWith("Rainy Day Savings ••5555", "asset"));
    await waitFor(() =>
      expect(importMock).toHaveBeenCalledWith("acc-new", expect.objectContaining({ accountLast4: "5555" }), { settleBefore: false }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("1 added, 1 to categorize.");
  });

  it("picks the account named with the statement's last four digits", async () => {
    readLines.mockResolvedValue(statement.map((l) => l.replace("36100005555", "36100004321")));
    render(<StatementImporter context={{ accounts }} />);

    fireEvent.change(screen.getByLabelText("Statement PDF"), {
      target: { files: [new File(["%PDF"], "s.pdf", { type: "application/pdf" })] },
    });

    expect(await screen.findByLabelText("Into")).toHaveValue("acc-checking");
    expect(screen.queryByLabelText("New account name")).toBeNull();
  });

  it("passes on settling the history before the statement when ticked", async () => {
    readLines.mockResolvedValue(statement.map((l) => l.replace("36100005555", "36100004321")));
    importMock.mockResolvedValue({ success: true, added: 1, alreadyThere: 0, reconciled: true });
    render(<StatementImporter context={{ accounts }} />);
    fireEvent.change(screen.getByLabelText("Statement PDF"), {
      target: { files: [new File(["%PDF"], "s.pdf", { type: "application/pdf" })] },
    });

    fireEvent.click(await screen.findByLabelText("Everything before 2026-09-01 is settled"));
    fireEvent.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() => expect(importMock).toHaveBeenCalledWith("acc-checking", expect.anything(), { settleBefore: true }));
  });

  it("marks a statement imported earlier as reconciled when a later one's transfers finish it", async () => {
    const two = [
      "capitalone.com",
      "Sep 1 - Sep 30, 2026",
      "Checking - 36100004321",
      "Sep 1 | Opening Balance | $100.00",
      "Sep 2 | Autopilot Transfer | Debit | - $15.00 | $85.00",
      "Sep 30 | Closing Balance | $85.00",
      "Savings - 36100008765",
      "Sep 1 | Opening Balance | $500.00",
      "Sep 2 | Autopilot Transfer | Credit | + $15.00 | $515.00",
      "Sep 30 | Closing Balance | $515.00",
    ];
    readLines.mockResolvedValue(two);
    const both = [...accounts, { id: "acc-savings", name: "Savings ••8765", account_number: "1202", type: "asset" }];
    importMock
      .mockResolvedValueOnce({ success: true, added: 1, alreadyThere: 0, uncategorized: 1, reconciled: false })
      .mockResolvedValueOnce({ success: true, added: 1, alreadyThere: 0, reconciled: true, alsoReconciled: ["acc-checking"] });
    render(<StatementImporter context={{ accounts: both }} />);
    fireEvent.change(screen.getByLabelText("Statement PDF"), {
      target: { files: [new File(["%PDF"], "s.pdf", { type: "application/pdf" })] },
    });

    const [first] = await screen.findAllByRole("button", { name: "Import" });
    fireEvent.click(first);
    expect(await screen.findByText(/1 to categorize/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() => expect(screen.getAllByText(/Statement reconciled/)).toHaveLength(2));
    expect(screen.queryByText(/to categorize/)).toBeNull();
  });
});
