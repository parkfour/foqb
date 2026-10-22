import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  TransactionRegister,
  type RegisterTransaction,
  type RegisterAccount,
} from "@/components/transactions/transaction-register";

const pushMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));

const mockAccounts: RegisterAccount[] = [
  { id: "acc-checking", name: "Checking Account", account_number: "1000" },
  { id: "acc-groceries", name: "Groceries", account_number: "5100" },
  { id: "acc-salary", name: "Salary Income", account_number: "4000" },
];

const mockTransactions: RegisterTransaction[] = [
  {
    id: "tx-1",
    date: "2026-03-01",
    account_id: "acc-checking",
    account_name: "Checking Account",
    name: "Employer Payroll",
    amount: 3000.0,
    category_id: "acc-salary",
    category_name: "Salary Income",
    is_split: false,
    status: "reconciled",
    categorized: true,
  },
  {
    id: "tx-2",
    date: "2026-03-05",
    account_id: "acc-checking",
    account_name: "Checking Account",
    name: "Whole Foods",
    amount: -120.5,
    category_id: "acc-groceries",
    category_name: "Groceries",
    is_split: false,
    status: "cleared",
    categorized: true,
  },
  {
    id: "tx-3",
    date: "2026-03-10",
    account_id: "acc-checking",
    account_name: "Checking Account",
    name: "Target Store",
    amount: -85.25,
    category_id: null,
    category_name: "Uncategorized",
    is_split: false,
    status: "pending",
    categorized: false,
  },
];

afterEach(() => {
  cleanup();
});

const ok = () => Promise.resolve({ success: true });

describe("TransactionRegister", () => {
  it("renders the register columns", () => {
    render(<TransactionRegister transactions={mockTransactions} accounts={mockAccounts} />);

    for (const heading of ["Date", "Account", "Payee / Merchant", "Category / Split", "Status", "Outflow", "Inflow", "Running total"]) {
      expect(screen.getByText(heading)).toBeInTheDocument();
    }
  });

  it("lists categories apart from bank accounts, and filters to one", () => {
    const accounts = mockAccounts.map((a) => ({ ...a, has_bank_feed: a.id === "acc-checking" }));
    render(<TransactionRegister transactions={mockTransactions} accounts={accounts} />);
    const filter = screen.getByLabelText(/filter by account/i);
    const categories = within(filter).getByRole("group", { name: "Categories" });
    expect(within(categories).getByRole("option", { name: "Salary Income" })).toBeInTheDocument();
    expect(within(categories).queryByRole("option", { name: "Checking Account" })).not.toBeInTheDocument();

    fireEvent.change(filter, { target: { value: "acc-salary" } });
    expect(pushMock).toHaveBeenCalledWith("/register?account=acc-salary");
    expect(screen.getByText("Employer Payroll")).toBeInTheDocument();
    expect(screen.queryByText("Whole Foods")).not.toBeInTheDocument();
  });

  it("shows a running total only once a single account is selected", () => {
    render(<TransactionRegister transactions={mockTransactions} accounts={mockAccounts} />);
    expect(screen.queryByText("$2,879.50")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/filter by account/i), { target: { value: "acc-checking" } });

    // 3,000.00, then less 120.50, then less 85.25
    expect(screen.getAllByText("$3,000.00").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("$2,879.50")).toBeInTheDocument();
    expect(screen.getByText("$2,794.25")).toBeInTheDocument();
    // ...and reloads with that account's whole history.
    expect(pushMock).toHaveBeenCalledWith("/register?account=acc-checking");
  });

  it("offers older transactions only when the page has more", () => {
    const { rerender } = render(<TransactionRegister transactions={mockTransactions} accounts={mockAccounts} />);
    expect(screen.queryByRole("link", { name: /load older/i })).not.toBeInTheDocument();

    rerender(<TransactionRegister transactions={mockTransactions} accounts={mockAccounts} olderHref="/register?pages=2" />);
    expect(screen.getByRole("link", { name: /load older/i })).toHaveAttribute("href", "/register?pages=2");
  });

  it("toggles cleared, and leaves a reconciled transaction alone", async () => {
    const onClearedToggle = vi.fn(ok);
    render(<TransactionRegister transactions={mockTransactions} accounts={mockAccounts} onClearedToggle={onClearedToggle} />);

    fireEvent.click(screen.getByRole("button", { name: "R" }));
    expect(onClearedToggle).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "P" }));
    expect(onClearedToggle).toHaveBeenCalledWith("tx-3", true);

    fireEvent.click(screen.getAllByRole("button", { name: "C" })[0]);
    expect(onClearedToggle).toHaveBeenCalledWith("tx-2", false);
  });

  it("puts the row back and says so when saving fails", async () => {
    const onClearedToggle = vi.fn(() => Promise.resolve({ success: false, error: "Not allowed" }));
    render(<TransactionRegister transactions={mockTransactions} accounts={mockAccounts} onClearedToggle={onClearedToggle} />);

    fireEvent.click(screen.getByRole("button", { name: "P" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Not allowed");
    expect(screen.getByRole("button", { name: "P" })).toBeInTheDocument();
  });

  it("categorizes only uncategorized transactions, as a one-line split", async () => {
    const onSplitSave = vi.fn(ok);
    render(<TransactionRegister transactions={mockTransactions} accounts={mockAccounts} onSplitSave={onSplitSave} />);

    expect(screen.queryByLabelText("Category for Whole Foods")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Category for Target Store"), { target: { value: "acc-groceries" } });

    await waitFor(() =>
      expect(onSplitSave).toHaveBeenCalledWith("tx-3", [{ account_id: "acc-groceries", amount: 85.25 }]),
    );
  });

  it("re-opens a categorized transaction, but not a reconciled one", async () => {
    const onReopen = vi.fn().mockResolvedValue({ success: true });
    render(<TransactionRegister transactions={mockTransactions} accounts={mockAccounts} onReopen={onReopen} />);

    const reconciled = screen.getByText("Employer Payroll").closest("tr")!;
    expect(within(reconciled).queryByRole("button", { name: "Re-open" })).toBeNull();

    const groceries = screen.getByText("Whole Foods").closest("tr")!;
    fireEvent.click(within(groceries).getByRole("button", { name: "Re-open" }));

    await waitFor(() => expect(onReopen).toHaveBeenCalledWith("tx-2"));
    await waitFor(() => expect(screen.getByLabelText("Category for Whole Foods")).toBeTruthy());
  });

  it("changes a reconciled transaction's category in place", async () => {
    const onRecategorize = vi.fn().mockResolvedValue({ success: true, journalEntryId: "je-new" });
    render(<TransactionRegister transactions={mockTransactions} accounts={mockAccounts} onRecategorize={onRecategorize} />);

    const picker = screen.getByLabelText("Change category for Employer Payroll") as HTMLSelectElement;
    expect(picker.value).toBe("acc-salary");
    // Not its own bank account.
    expect(within(picker).queryByRole("option", { name: /Checking Account/ })).toBeNull();
    fireEvent.change(picker, { target: { value: "acc-groceries" } });

    await waitFor(() => expect(onRecategorize).toHaveBeenCalledWith("tx-1", "acc-groceries"));
    expect(picker.value).toBe("acc-groceries");
  });

  it("shows why a category can't be changed in place, and puts it back if the change fails", async () => {
    const split: RegisterTransaction = { ...mockTransactions[1], id: "tx-9", name: "Costco", recategorize_blocker: "A split — re-book it from Journal Entries" };
    const onRecategorize = vi.fn().mockResolvedValue({ success: false, error: "In a locked period" });
    render(<TransactionRegister transactions={[mockTransactions[0], split]} accounts={mockAccounts} onRecategorize={onRecategorize} />);

    expect(screen.queryByLabelText("Change category for Costco")).toBeNull();
    expect(screen.getByTitle("A split — re-book it from Journal Entries")).toHaveTextContent("Groceries");

    const picker = screen.getByLabelText("Change category for Employer Payroll") as HTMLSelectElement;
    fireEvent.change(picker, { target: { value: "acc-groceries" } });
    expect(await screen.findByText("In a locked period")).toBeInTheDocument();
    expect(picker.value).toBe("acc-salary");
  });

  it("books a suggested transfer from either side", async () => {
    const onTransfer = vi.fn().mockResolvedValue({ success: true });
    const transfer: RegisterTransaction = {
      id: "tx-out",
      date: "2026-03-10",
      account_id: "acc-checking",
      account_name: "Checking Account",
      name: "TRANSFER TO CARD",
      amount: -500,
      category_name: "Uncategorized",
      is_split: false,
      status: "pending",
      categorized: false,
      transfer: { account_id: "acc-card", account_name: "Visa" },
    };
    render(<TransactionRegister transactions={[transfer]} accounts={mockAccounts} onTransfer={onTransfer} />);

    fireEvent.click(screen.getByRole("button", { name: "Transfer to Visa" }));

    await waitFor(() => expect(onTransfer).toHaveBeenCalledWith("tx-out", "acc-card"));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Transfer to Visa" })).toBeNull());
  });

  it("offers to categorize the payee the same way from now on", async () => {
    const onSplitSave = vi.fn().mockResolvedValue({ success: true });
    const onSavePayeeRule = vi.fn().mockResolvedValue({ success: true, categorizedIds: ["tx-4"] });
    const another: RegisterTransaction = { ...mockTransactions[2], id: "tx-4", name: "TARGET STORE #12" };
    render(
      <TransactionRegister
        transactions={[...mockTransactions, another]}
        accounts={mockAccounts}
        onSplitSave={onSplitSave}
        onSavePayeeRule={onSavePayeeRule}
      />,
    );

    fireEvent.change(screen.getByLabelText("Category for Target Store"), { target: { value: "acc-groceries" } });

    const text = await screen.findByLabelText(/always categorize payees containing/i);
    expect(text).toHaveValue("Target Store");
    expect(screen.getByText(/the 1 matching uncategorized transaction listed/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save rule" }));

    await waitFor(() => expect(onSavePayeeRule).toHaveBeenCalledWith("tx-3", "Target Store", "acc-groceries"));
    await waitFor(() => expect(screen.queryByLabelText("Category for TARGET STORE #12")).toBeNull());
    expect(screen.getByRole("status")).toHaveTextContent(/1 more transaction categorized/);
  });

  it("creates an account from the category list and categorizes the row to it", async () => {
    const onSplitSave = vi.fn().mockResolvedValue({ success: true });
    const onCreateAccount = vi
      .fn()
      .mockResolvedValue({ success: true, account: { id: "acc-pets", name: "Pets", account_number: "5010", type: "expense" } });
    render(
      <TransactionRegister
        transactions={mockTransactions}
        accounts={mockAccounts}
        onSplitSave={onSplitSave}
        onCreateAccount={onCreateAccount}
      />,
    );

    fireEvent.change(screen.getByLabelText("Category for Target Store"), { target: { value: "__new__" } });
    fireEvent.change(screen.getByLabelText("New account"), { target: { value: "Pets" } });
    expect(screen.getByLabelText("New account type")).toHaveValue("expense");
    fireEvent.click(screen.getByRole("button", { name: "Create and categorize" }));

    await waitFor(() => expect(onCreateAccount).toHaveBeenCalledWith("Pets", "expense"));
    await waitFor(() => expect(onSplitSave).toHaveBeenCalledWith("tx-3", [{ account_id: "acc-pets", amount: 85.25 }]));
    // The prompt to make it a rule shows under the row.
    expect(await screen.findByLabelText(/always categorize payees containing/i)).toBeInTheDocument();
    expect(screen.getByText("Pets", { selector: "strong" })).toBeInTheDocument();
  });

  it("books every matched transfer at once", async () => {
    const onBookAllTransfers = vi.fn().mockResolvedValue({ success: true, bookedIds: ["tx-out", "tx-in"] });
    const base = { date: "2026-03-10", category_name: "Uncategorized", is_split: false, status: "pending" as const, categorized: false };
    const rows: RegisterTransaction[] = [
      { ...base, id: "tx-out", account_id: "acc-checking", account_name: "Checking Account", name: "TO CARD", amount: -500, transfer: { account_id: "acc-card", account_name: "Visa" } },
      { ...base, id: "tx-in", account_id: "acc-card", account_name: "Visa", name: "PAYMENT", amount: 500, transfer: { account_id: "acc-checking", account_name: "Checking Account" } },
    ];
    render(<TransactionRegister transactions={rows} accounts={mockAccounts} onBookAllTransfers={onBookAllTransfers} />);

    fireEvent.click(screen.getByRole("button", { name: "Book all 1 matched transfer" }));

    await waitFor(() => expect(onBookAllTransfers).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("button", { name: /book all/i })).toBeNull());
    expect(screen.getByRole("status")).toHaveTextContent("1 transfer booked.");
  });

  it("supports quick search filtering by payee or category", () => {
    render(
      <TransactionRegister
        transactions={mockTransactions}
        accounts={mockAccounts}
      />,
    );

    const searchInput = screen.getByPlaceholderText(/search payee/i);
    fireEvent.change(searchInput, { target: { value: "Whole Foods" } });

    expect(screen.getByText("Whole Foods")).toBeInTheDocument();
    expect(screen.queryByText("Employer Payroll")).not.toBeInTheDocument();
  });

  it("filters transactions by status", () => {
    render(
      <TransactionRegister
        transactions={mockTransactions}
        accounts={mockAccounts}
      />,
    );

    const statusFilter = screen.getByLabelText(/filter by status/i);
    fireEvent.change(statusFilter, { target: { value: "cleared" } });

    expect(screen.getByText("Whole Foods")).toBeInTheDocument();
    expect(screen.queryByText("Employer Payroll")).not.toBeInTheDocument();
  });

  it("offers Split only on uncategorized transactions, and opens the modal", () => {
    render(<TransactionRegister transactions={mockTransactions} accounts={mockAccounts} />);

    expect(screen.queryByRole("button", { name: /split whole foods/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /split target store/i }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/Target Store/)).toBeInTheDocument();
  });

  it("supports keyboard navigation with arrow keys to navigate table rows", () => {
    render(
      <TransactionRegister
        transactions={mockTransactions}
        accounts={mockAccounts}
      />,
    );

    const tbody = screen.getAllByRole("rowgroup")[1];

    // Press ArrowDown to select first row
    fireEvent.keyDown(tbody, { key: "ArrowDown" });
    const rows = screen.getAllByRole("row");
    // Row 1 is header, row 2 is the first data row
    expect(rows[1]).toHaveClass("bg-blue-50/80");

    // Press ArrowDown again to select second row
    fireEvent.keyDown(tbody, { key: "ArrowDown" });
    expect(rows[2]).toHaveClass("bg-blue-50/80");
  });
});
