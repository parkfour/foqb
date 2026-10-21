import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { useRouterMock, pushMock } = vi.hoisted(() => {
  const pushMock = vi.fn();
  return { useRouterMock: vi.fn(() => ({ push: pushMock })), pushMock };
});

vi.mock("next/navigation", () => ({ useRouter: useRouterMock }));

import { BillForm } from "@/components/vendors/bill-form";

const vendors = [{ id: "vend-1", name: "Office Supply Co" }];
const accounts = [{ id: "acc-1", account_number: "6000", name: "Office Expense" }];

afterEach(() => {
  cleanup();
  pushMock.mockClear();
});

describe("BillForm", () => {
  it("requires a vendor and bill number before submitting", () => {
    const { container } = render(<BillForm organizationId="org-1" vendors={vendors} accounts={accounts} />);

    // Both fields are also natively `required`; dispatch submit directly
    // to bypass HTML5 constraint validation and reach the JS fallback.
    fireEvent.submit(container.querySelector("form")!);

    expect(screen.getByText(/vendor and bill number are required/i)).toBeInTheDocument();
  });

  it("requires at least one line with an account selected", () => {
    render(<BillForm organizationId="org-1" vendors={vendors} accounts={accounts} />);

    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "vend-1" } });
    fireEvent.change(screen.getByPlaceholderText("Bill number"), { target: { value: "BILL-1" } });

    fireEvent.click(screen.getByRole("button", { name: "Enter Bill" }));

    expect(screen.getByText(/add at least one line/i)).toBeInTheDocument();
  });

  it("computes the total from quantity × unit price across lines", () => {
    render(<BillForm organizationId="org-1" vendors={vendors} accounts={accounts} />);

    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "acc-1" } });
    fireEvent.change(screen.getAllByPlaceholderText("Qty")[0], { target: { value: "3" } });
    fireEvent.change(screen.getAllByPlaceholderText("Unit price")[0], { target: { value: "20" } });

    expect(screen.getByText("Total: $60.00")).toBeInTheDocument();
  });

  it("posts the parsed lines to the API and navigates away on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    render(<BillForm organizationId="org-1" vendors={vendors} accounts={accounts} />);

    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "vend-1" } });
    fireEvent.change(screen.getByPlaceholderText("Bill number"), { target: { value: "BILL-1" } });
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "acc-1" } });
    fireEvent.change(screen.getAllByPlaceholderText("Unit price")[0], { target: { value: "20" } });

    fireEvent.click(screen.getByRole("button", { name: "Enter Bill" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/vendors"));

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/bills");
    const body = JSON.parse(options.body as string) as { vendor_id: string; lines: unknown[] };
    expect(body.vendor_id).toBe("vend-1");
    expect(body.lines).toEqual([{ account_id: "acc-1", description: "", quantity: 1, unit_price: 20 }]);

    vi.unstubAllGlobals();
  });
});
