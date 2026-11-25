import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SplitTransactionModal } from "@/components/transactions/split-transaction-modal";

const accounts = [
  { id: "acc-groceries", name: "Groceries", account_number: "5100" },
  { id: "acc-dining", name: "Dining Out", account_number: "5200" },
  { id: "acc-household", name: "Household Supplies", account_number: "5300" },
];

const mockTx = {
  id: "tx-1",
  date: "2026-03-15",
  name: "Costco Wholesale",
  amount: -150.0,
  account_id: "bank-checking",
};

afterEach(() => {
  cleanup();
});

describe("SplitTransactionModal", () => {
  it("renders transaction details and initial split line when open", () => {
    render(
      <SplitTransactionModal
        isOpen={true}
        onClose={vi.fn()}
        transaction={mockTx}
        accounts={accounts}
      />,
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Split Transaction")).toBeInTheDocument();
    expect(screen.getByText(/Costco Wholesale/)).toBeInTheDocument();
    expect(screen.getAllByText(/\$150\.00/).length).toBeGreaterThanOrEqual(1);

    // Submit button should initially be disabled because no account is selected yet
    const saveButton = screen.getByRole("button", { name: "Save Split" });
    expect(saveButton).toBeDisabled();
  });

  it("does not render when isOpen is false", () => {
    render(
      <SplitTransactionModal
        isOpen={false}
        onClose={vi.fn()}
        transaction={mockTx}
        accounts={accounts}
      />,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("allows adding and removing split lines dynamically", () => {
    render(
      <SplitTransactionModal
        isOpen={true}
        onClose={vi.fn()}
        transaction={mockTx}
        accounts={accounts}
      />,
    );

    expect(screen.getAllByRole("combobox")).toHaveLength(1);

    // Click "Add Split Line"
    fireEvent.click(screen.getByRole("button", { name: /add split line/i }));
    expect(screen.getAllByRole("combobox")).toHaveLength(2);

    // Delete buttons should now appear
    const deleteButtons = screen.getAllByLabelText(/delete line/i);
    expect(deleteButtons).toHaveLength(2);

    // Delete the second line
    fireEvent.click(deleteButtons[1]);
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
  });

  it("prevents submission when the sum of split lines does not match the parent total", () => {
    render(
      <SplitTransactionModal
        isOpen={true}
        onClose={vi.fn()}
        transaction={mockTx}
        accounts={accounts}
      />,
    );

    // Select account for first line
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "acc-groceries" } });

    // Change amount to 100 (parent is 150)
    const amountInput = screen.getByLabelText("Amount for line 1");
    fireEvent.change(amountInput, { target: { value: "100.00" } });

    // Remaining $50 should be shown, Save button disabled
    expect(screen.getByText(/Remaining: \$50\.00/)).toBeInTheDocument();
    const saveButton = screen.getByRole("button", { name: "Save Split" });
    expect(saveButton).toBeDisabled();
  });

  it("enables submission and calls onSave when all lines have accounts and sum matches", async () => {
    const onSave = vi.fn();
    render(
      <SplitTransactionModal
        isOpen={true}
        onClose={vi.fn()}
        transaction={mockTx}
        accounts={accounts}
        onSave={onSave}
      />,
    );

    // Line 1: $100 groceries
    const select1 = screen.getByRole("combobox");
    fireEvent.change(select1, { target: { value: "acc-groceries" } });
    const amount1 = screen.getByLabelText("Amount for line 1");
    fireEvent.change(amount1, { target: { value: "100.00" } });

    // Add line 2: $50 household
    fireEvent.click(screen.getByRole("button", { name: /add split line/i }));
    const select2 = screen.getByLabelText("Category for line 2");
    fireEvent.change(select2, { target: { value: "acc-household" } });
    const amount2 = screen.getByLabelText("Amount for line 2");
    fireEvent.change(amount2, { target: { value: "50.00" } });

    // Balanced!
    expect(screen.getByText("Balanced")).toBeInTheDocument();
    const saveButton = screen.getByRole("button", { name: "Save Split" });
    expect(saveButton).not.toBeDisabled();

    fireEvent.click(saveButton);

    expect(onSave).toHaveBeenCalledWith([
      { account_id: "acc-groceries", amount: 100, memo: "Costco Wholesale" },
      { account_id: "acc-household", amount: 50, memo: "" },
    ]);
  });
});

describe("SplitTransactionModal classes and currency", () => {
  it("puts the class picked on its line", async () => {
    const onSave = vi.fn();
    render(
      <SplitTransactionModal
        isOpen={true}
        onClose={vi.fn()}
        transaction={mockTx}
        accounts={accounts}
        classes={[{ id: "cls-west", name: "West" }]}
        onSave={onSave}
      />,
    );

    fireEvent.change(screen.getByLabelText("Category for line 1"), { target: { value: "acc-groceries" } });
    fireEvent.change(screen.getByLabelText("Class for line 1"), { target: { value: "cls-west" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Split" }));

    await vi.waitFor(() =>
      expect(onSave).toHaveBeenCalledWith([
        { account_id: "acc-groceries", amount: 150, memo: "Costco Wholesale", class_id: "cls-west" },
      ]),
    );
  });

  it("has no class column when the book has no classes", () => {
    render(<SplitTransactionModal isOpen={true} onClose={vi.fn()} transaction={mockTx} accounts={accounts} />);
    expect(screen.queryByLabelText("Class for line 1")).not.toBeInTheDocument();
  });

  it("shows totals in the account's currency", () => {
    render(
      <SplitTransactionModal
        isOpen={true}
        onClose={vi.fn()}
        transaction={{ ...mockTx, amount: -150000, currency: "KRW" }}
        accounts={accounts}
      />,
    );
    expect(screen.getAllByText(/₩150,000/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Amount (KRW)")).toBeInTheDocument();
    expect(screen.queryByText(/\$150,000/)).not.toBeInTheDocument();
  });
});
