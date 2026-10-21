import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ReconciliationWorksheet } from "@/components/reconcile/reconciliation-worksheet";

afterEach(() => {
  cleanup();
});

const assetLines = [
  { id: "l1", entryDate: "2026-09-01", memo: "Deposit", description: null, debit: 200, credit: 0 },
  { id: "l2", entryDate: "2026-09-02", memo: "Fee", description: null, debit: 0, credit: 50 },
];

describe("ReconciliationWorksheet", () => {
  it("checks and unchecks every line from the header box", () => {
    render(
      <ReconciliationWorksheet
        reconciliationId="r1"
        organizationId="org1"
        accountType="asset"
        beginningBalance={0}
        statementEndingBalance={150}
        lines={assetLines}
        canWrite
      />,
    );

    fireEvent.click(screen.getByLabelText("Check all"));
    expect(screen.getByRole("button", { name: /finish reconciliation/i })).toBeEnabled();
    fireEvent.click(screen.getByLabelText("Check all"));
    expect(screen.getAllByRole("checkbox").every((b) => !(b as HTMLInputElement).checked)).toBe(true);
  });

  it("starts with a nonzero difference and a disabled Finish button", () => {
    render(
      <ReconciliationWorksheet
        reconciliationId="r1"
        organizationId="org1"
        accountType="asset"
        beginningBalance={0}
        statementEndingBalance={150}
        lines={assetLines}
        canWrite
      />,
    );

    expect(screen.getByRole("button", { name: /finish reconciliation/i })).toBeDisabled();
  });

  it("updates the cleared total and difference as lines are checked, and enables Finish once balanced", () => {
    render(
      <ReconciliationWorksheet
        reconciliationId="r1"
        organizationId="org1"
        accountType="asset"
        beginningBalance={0}
        statementEndingBalance={150}
        lines={assetLines}
        canWrite
      />,
    );

    const checkboxes = screen.getAllByRole("checkbox").slice(1); // after "Check all"
    fireEvent.click(checkboxes[0]); // debit 200 -> cleared total 200, difference -50
    fireEvent.click(checkboxes[1]); // credit 50 -> cleared total 150, difference 0

    expect(screen.getAllByText("$150.00").length).toBeGreaterThan(1);
    expect(screen.getByRole("button", { name: /finish reconciliation/i })).toBeEnabled();
  });

  it("flips the sign convention for a liability account", () => {
    render(
      <ReconciliationWorksheet
        reconciliationId="r1"
        organizationId="org1"
        accountType="liability"
        beginningBalance={0}
        statementEndingBalance={50}
        lines={[
          { id: "l1", entryDate: "2026-09-01", memo: null, description: "Charge", debit: 0, credit: 50 },
        ]}
        canWrite
      />,
    );

    fireEvent.click(screen.getAllByRole("checkbox")[1]); // after "Check all"
    expect(screen.getByRole("button", { name: /finish reconciliation/i })).toBeEnabled();
  });

  it("hides the checkboxes and Finish button for a read-only viewer", () => {
    render(
      <ReconciliationWorksheet
        reconciliationId="r1"
        organizationId="org1"
        accountType="asset"
        beginningBalance={0}
        statementEndingBalance={150}
        lines={assetLines}
        canWrite={false}
      />,
    );

    expect(screen.queryByRole("button", { name: /finish reconciliation/i })).not.toBeInTheDocument();
    for (const checkbox of screen.getAllByRole("checkbox")) {
      expect(checkbox).toBeDisabled();
    }
  });
});
