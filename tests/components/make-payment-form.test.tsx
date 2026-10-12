import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { useRouterMock, pushMock } = vi.hoisted(() => {
  const pushMock = vi.fn();
  return { useRouterMock: vi.fn(() => ({ push: pushMock })), pushMock };
});

vi.mock("next/navigation", () => ({ useRouter: useRouterMock }));

import { MakePaymentForm } from "@/components/vendors/make-payment-form";

const vendors = [
  { id: "vend-1", name: "Office Supply Co" },
  { id: "vend-2", name: "Other Vendor" },
];
const bills = [
  { id: "bill-1", billNumber: "BILL-1", vendorId: "vend-1", remaining: 200 },
  { id: "bill-2", billNumber: "BILL-2", vendorId: "vend-2", remaining: 75 },
];
const accounts = [{ id: "acc-1", account_number: "1000", name: "Checking" }];

afterEach(() => {
  cleanup();
  pushMock.mockClear();
});

describe("MakePaymentForm", () => {
  it("only lists bills belonging to the selected vendor", () => {
    render(<MakePaymentForm vendors={vendors} bills={bills} accounts={accounts} bankTransactions={[]} />);

    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "vend-1" } });

    expect(screen.getByRole("option", { name: /BILL-1/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /BILL-2/ })).not.toBeInTheDocument();
  });

  it("takes the absolute value of a matched withdrawal's (negative) amount", () => {
    const bankTransactions = [{ id: "tx-1", date: "2026-01-01", name: "Withdrawal", amount: -75 }];
    render(
      <MakePaymentForm vendors={vendors} bills={bills} accounts={accounts} bankTransactions={bankTransactions} />,
    );

    // customer, bill, then the bank-transaction matcher (not label-associated).
    fireEvent.change(screen.getAllByRole("combobox")[2], { target: { value: "tx-1" } });

    expect(screen.getByPlaceholderText("Amount")).toHaveValue(75);
    expect(screen.getByPlaceholderText("Amount")).toHaveAttribute("readonly");
    expect(screen.queryByText("Pay from…")).not.toBeInTheDocument();
  });

  it("requires bill, amount, and a payment account or matched transaction", () => {
    const { container } = render(
      <MakePaymentForm vendors={vendors} bills={bills} accounts={accounts} bankTransactions={[]} />,
    );

    fireEvent.submit(container.querySelector("form")!);

    expect(
      screen.getByText(/bill, amount, and a payment account or matched bank transaction are required/i),
    ).toBeInTheDocument();
  });

  it("posts the payment with a manually chosen payment account", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    render(<MakePaymentForm vendors={vendors} bills={bills} accounts={accounts} bankTransactions={[]} />);

    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "vend-1" } });
    fireEvent.change(selects[1], { target: { value: "bill-1" } });
    fireEvent.change(screen.getByPlaceholderText("Amount"), { target: { value: "200" } });
    fireEvent.change(selects[2], { target: { value: "acc-1" } });

    fireEvent.click(screen.getByRole("button", { name: "Make Payment" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/vendors"));

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/bill-payments");
    const body = JSON.parse(options.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      bill_id: "bill-1",
      amount: 200,
      payment_account_id: "acc-1",
      bank_transaction_id: null,
    });

    vi.unstubAllGlobals();
  });
});
