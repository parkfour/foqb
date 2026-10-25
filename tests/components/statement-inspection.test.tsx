// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { inspectStatementDocument } from "@/plugins/statement-import/inspect";
import { StatementInspectionDialog } from "@/plugins/statement-import/statement-inspection-dialog";
import { StatementImporter } from "@/plugins/statement-import/statement-importer";

const { readLinesMock } = vi.hoisted(() => ({ readLinesMock: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/plugins/statement-import/read-statement", () => ({ readStatementLines: readLinesMock }));
vi.mock("@/plugins/statement-import/actions", () => ({ importStatementAction: vi.fn() }));
vi.mock("@/app/(dashboard)/accounts/actions", () => ({ createAccountQuickAction: vi.fn() }));

const mockAccounts = [
  { id: "acc-1", name: "Operating Checking ••1234", account_number: "1000", type: "asset" },
  { id: "acc-2", name: "Business Credit Card ••5678", account_number: "2000", type: "liability" },
];

// An unrecognized layout that fails automatic parsing
const unrecognizedStatementLines = [
  "CHASE BANK COMMERCIAL STATEMENT",
  "Account Number: ************4821",
  "Statement Period: 10/01/2026 to 10/31/2026",
  "Beginning Balance: $4,500.00",
  "10/02/2026 | Office Supply Depot | $150.00",
  "10/05/2026 | Client Invoice Pmt | $2,000.00",
  "10/12/2026 | Software Subscription | $49.00",
  "Ending Balance: $6,301.00",
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Statement Document Inspection", () => {
  it("inspects document lines and identifies institutions, accounts, periods, and balances", () => {
    const inspection = inspectStatementDocument(unrecognizedStatementLines);

    expect(inspection.detectedBank).toBe("Chase");
    expect(inspection.detectedAccountLast4).toBe("4821");
    expect(inspection.detectedPeriod).toEqual({
      start: "10/01/2026",
      end: "10/31/2026",
    });
    expect(inspection.openingBalance).toBe(4500.0);
    expect(inspection.closingBalance).toBe(6301.0);
  });

  it("extracts candidate transactions with dates and amounts", () => {
    const inspection = inspectStatementDocument(unrecognizedStatementLines);

    expect(inspection.candidateTransactions.length).toBe(3);
    expect(inspection.candidateTransactions[0]).toEqual(
      expect.objectContaining({
        date: "10/02/2026",
        description: "Office Supply Depot",
        amount: 150.0,
      }),
    );
    expect(inspection.candidateTransactions[1]).toEqual(
      expect.objectContaining({
        date: "10/05/2026",
        description: "Client Invoice Pmt",
        amount: 2000.0,
      }),
    );
  });

  it("tags lines with semantic entity categories", () => {
    const inspection = inspectStatementDocument(unrecognizedStatementLines);

    expect(inspection.taggedLines.length).toBeGreaterThan(0);
    const dateTagged = inspection.taggedLines.filter((tl) =>
      tl.tags.some((t) => t.category === "date"),
    );
    expect(dateTagged.length).toBeGreaterThanOrEqual(3);

    const amountTagged = inspection.taggedLines.filter((tl) =>
      tl.tags.some((t) => t.category === "amount"),
    );
    expect(amountTagged.length).toBeGreaterThanOrEqual(3);
  });
});

describe("StatementInspectionDialog Component", () => {
  it("renders detected metadata badges and tagged lines", () => {
    const inspection = inspectStatementDocument(unrecognizedStatementLines);
    const onClose = vi.fn();

    render(
      <StatementInspectionDialog inspection={inspection} onClose={onClose} />,
    );

    expect(screen.getByText("Document Structure & Recognized Entities")).toBeInTheDocument();
    expect(screen.getByText("Chase")).toBeInTheDocument();
    expect(screen.getByText("•••• 4821")).toBeInTheDocument();
    expect(screen.getByText(/10\/01\/2026 - 10\/31\/2026/)).toBeInTheDocument();

    // Line breakdown tab
    expect(screen.getByText(/CHASE BANK COMMERCIAL STATEMENT/)).toBeInTheDocument();

    // Switch to candidates tab
    fireEvent.click(screen.getByText(/Candidate Transactions \(3\)/));
    expect(screen.getByText("Office Supply Depot")).toBeInTheDocument();
    expect(screen.getByText("Client Invoice Pmt")).toBeInTheDocument();
  });

  it("offers no import: loose rows carry no sign or balance check", () => {
    render(<StatementInspectionDialog inspection={inspectStatementDocument(unrecognizedStatementLines)} onClose={vi.fn()} />);

    fireEvent.click(screen.getByText(/Candidate Transactions \(3\)/));
    expect(screen.queryByRole("button", { name: /import/i })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});

describe("StatementImporter Fallback Integration", () => {
  it("automatically presents the inspection dialog when automatic parsing fails", async () => {
    readLinesMock.mockResolvedValue(unrecognizedStatementLines);

    render(<StatementImporter context={{ accounts: mockAccounts }} />);

    const file = new File(["%PDF-content"], "unrecognized-chase.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("Statement PDF"), { target: { files: [file] } });

    // Inspection dialog should appear automatically
    expect(
      await screen.findByText("Document Structure & Recognized Entities"),
    ).toBeInTheDocument();
    expect(screen.getByText("Chase")).toBeInTheDocument();
  });
});
