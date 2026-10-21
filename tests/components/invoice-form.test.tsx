import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { useRouterMock, pushMock } = vi.hoisted(() => {
  const pushMock = vi.fn();
  return { useRouterMock: vi.fn(() => ({ push: pushMock })), pushMock };
});

vi.mock("next/navigation", () => ({ useRouter: useRouterMock }));

import { InvoiceForm } from "@/components/customers/invoice-form";

const customers = [{ id: "cust-1", name: "Acme Co" }];
const accounts = [{ id: "acc-1", account_number: "4000", name: "Sales" }];
const items = [
  { id: "item-1", name: "Widget", income_account_id: "acc-1", sale_price: 25 },
];

afterEach(() => {
  cleanup();
  pushMock.mockClear();
});

describe("InvoiceForm", () => {
  it("requires a customer and invoice number before submitting", () => {
    const { container } = render(
      <InvoiceForm organizationId="org-1" customers={customers} accounts={accounts} items={items} />,
    );

    // The customer <select> and invoice-number <input> are also natively
    // `required`, so a real click on the submit button never reaches this
    // JS-level check in a browser — dispatching `submit` directly (as
    // opposed to clicking) bypasses HTML5 constraint validation, which is
    // exactly what's needed to exercise this fallback branch.
    fireEvent.submit(container.querySelector("form")!);

    expect(screen.getByText(/customer and invoice number are required/i)).toBeInTheDocument();
  });

  it("requires at least one line with an account selected", () => {
    render(<InvoiceForm organizationId="org-1" customers={customers} accounts={accounts} items={items} />);

    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "cust-1" } }); // customer
    fireEvent.change(screen.getByPlaceholderText("Invoice number"), { target: { value: "INV-1" } });

    fireEvent.click(screen.getByRole("button", { name: "Create Invoice" }));

    expect(screen.getByText(/add at least one line/i)).toBeInTheDocument();
  });

  it("picking an item auto-fills description, revenue account, and unit price", () => {
    render(<InvoiceForm organizationId="org-1" customers={customers} accounts={accounts} items={items} />);

    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "item-1" } });

    expect(screen.getByPlaceholderText("Description")).toHaveValue("Widget");
    expect(screen.getByPlaceholderText("Unit price")).toHaveValue(25);
    expect(screen.getAllByRole("combobox")[2]).toHaveValue("acc-1");
  });

  it("computes subtotal, tax, and total from lines and the tax rate", () => {
    render(
      <InvoiceForm
        organizationId="org-1"
        customers={customers}
        accounts={accounts}
        items={items}
        defaultTaxRate={10}
      />,
    );

    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[2], { target: { value: "acc-1" } }); // revenue account
    fireEvent.change(screen.getAllByPlaceholderText("Qty")[0], { target: { value: "2" } });
    fireEvent.change(screen.getAllByPlaceholderText("Unit price")[0], { target: { value: "50" } });

    expect(screen.getByText("Subtotal: $100.00")).toBeInTheDocument();
    expect(screen.getByText("Tax: $10.00")).toBeInTheDocument();
    expect(screen.getByText("Total: $110.00")).toBeInTheDocument();
  });

  it("posts the parsed lines to the API and navigates away on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    render(<InvoiceForm organizationId="org-1" customers={customers} accounts={accounts} items={items} />);

    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "cust-1" } });
    fireEvent.change(screen.getByPlaceholderText("Invoice number"), { target: { value: "INV-1" } });
    fireEvent.change(selects[2], { target: { value: "acc-1" } });
    fireEvent.change(screen.getAllByPlaceholderText("Unit price")[0], { target: { value: "50" } });

    fireEvent.click(screen.getByRole("button", { name: "Create Invoice" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/customers"));

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/invoices");
    const body = JSON.parse(options.body as string) as { customer_id: string; lines: unknown[] };
    expect(body.customer_id).toBe("cust-1");
    expect(body.lines).toEqual([
      { item_id: null, account_id: "acc-1", description: "", quantity: 1, unit_price: 50 },
    ]);

    vi.unstubAllGlobals();
  });
});
