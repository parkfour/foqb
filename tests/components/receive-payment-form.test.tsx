import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { useRouterMock, pushMock } = vi.hoisted(() => {
  const pushMock = vi.fn();
  return { useRouterMock: vi.fn(() => ({ push: pushMock })), pushMock };
});

vi.mock("next/navigation", () => ({ useRouter: useRouterMock }));

import { ReceivePaymentForm } from "@/components/customers/receive-payment-form";

const customers = [
  { id: "cust-1", name: "Acme Co" },
  { id: "cust-2", name: "Beta LLC" },
];
const invoices = [
  { id: "inv-1", invoiceNumber: "INV-1", customerId: "cust-1", remaining: 100 },
  { id: "inv-2", invoiceNumber: "INV-2", customerId: "cust-2", remaining: 50 },
];
const accounts = [{ id: "acc-1", account_number: "1000", name: "Checking" }];

afterEach(() => {
  cleanup();
  pushMock.mockClear();
});

describe("ReceivePaymentForm", () => {
  it("only lists invoices belonging to the selected customer", () => {
    render(
      <ReceivePaymentForm customers={customers} invoices={invoices} accounts={accounts} bankTransactions={[]} />,
    );

    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "cust-1" } });

    expect(screen.getByRole("option", { name: /INV-1/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /INV-2/ })).not.toBeInTheDocument();
  });

  it("resets the invoice selection when the customer changes", () => {
    render(
      <ReceivePaymentForm customers={customers} invoices={invoices} accounts={accounts} bankTransactions={[]} />,
    );

    const [customerSelect, invoiceSelect] = screen.getAllByRole("combobox");
    fireEvent.change(customerSelect, { target: { value: "cust-1" } });
    fireEvent.change(invoiceSelect, { target: { value: "inv-1" } });
    expect(screen.getByText("Remaining balance: $100.00")).toBeInTheDocument();

    fireEvent.change(customerSelect, { target: { value: "cust-2" } });

    expect(screen.queryByText(/remaining balance/i)).not.toBeInTheDocument();
  });

  it("matching a bank transaction fills the amount and hides the deposit-account picker", () => {
    const bankTransactions = [{ id: "tx-1", date: "2026-01-01", name: "Deposit", amount: 100 }];
    render(
      <ReceivePaymentForm
        customers={customers}
        invoices={invoices}
        accounts={accounts}
        bankTransactions={bankTransactions}
      />,
    );

    // Not label-associated in the markup (no htmlFor/id), so select by
    // position: customer, invoice, then the bank-transaction matcher.
    fireEvent.change(screen.getAllByRole("combobox")[2], { target: { value: "tx-1" } });

    expect(screen.getByPlaceholderText("Amount")).toHaveValue(100);
    expect(screen.getByPlaceholderText("Amount")).toHaveAttribute("readonly");
    expect(screen.queryByText("Deposit to…")).not.toBeInTheDocument();
  });

  it("requires invoice, amount, and a deposit account or matched transaction", () => {
    const { container } = render(
      <ReceivePaymentForm customers={customers} invoices={invoices} accounts={accounts} bankTransactions={[]} />,
    );

    fireEvent.submit(container.querySelector("form")!);

    expect(
      screen.getByText(/invoice, amount, and a deposit account or matched bank transaction are required/i),
    ).toBeInTheDocument();
  });

  it("posts the payment with a manually chosen deposit account", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ReceivePaymentForm customers={customers} invoices={invoices} accounts={accounts} bankTransactions={[]} />,
    );

    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "cust-1" } });
    fireEvent.change(selects[1], { target: { value: "inv-1" } });
    fireEvent.change(screen.getByPlaceholderText("Amount"), { target: { value: "100" } });
    fireEvent.change(selects[2], { target: { value: "acc-1" } });

    fireEvent.click(screen.getByRole("button", { name: "Receive Payment" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/customers"));

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/invoice-payments");
    const body = JSON.parse(options.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      invoice_id: "inv-1",
      amount: 100,
      deposit_account_id: "acc-1",
      bank_transaction_id: null,
    });

    vi.unstubAllGlobals();
  });
});
