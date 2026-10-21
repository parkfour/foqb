import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { updateAccountTaxLineMock } = vi.hoisted(() => ({ updateAccountTaxLineMock: vi.fn() }));

vi.mock("@/app/(dashboard)/accounts/actions", () => ({
  updateAccountTaxLine: updateAccountTaxLineMock,
}));

import { TaxLineForm } from "@/components/accounts/tax-line-form";

const taxLines = [
  { id: "line-wages", form: "form_1040", code: "line_1a", label: "Wages" },
  { id: "line-rents", form: "schedule_e", code: "line_3", label: "Rents received" },
];
const properties = [{ id: "prop-1", name: "Main Street" }];
const account = { id: "acc-1", name: "Rent", tax_line_id: null, property_id: null };

afterEach(() => {
  cleanup();
  updateAccountTaxLineMock.mockReset();
});

describe("TaxLineForm", () => {
  it("asks for the property as soon as a Schedule E line is picked", () => {
    render(<TaxLineForm account={account} taxLines={taxLines} properties={properties} />);
    expect(screen.queryByLabelText("Property for Rent")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Tax line for Rent"), { target: { value: "line-rents" } });
    expect(screen.getByLabelText("Property for Rent")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Tax line for Rent"), { target: { value: "line-wages" } });
    expect(screen.queryByLabelText("Property for Rent")).not.toBeInTheDocument();
  });

  it("keeps the chosen line after saving, and shows a refused save", async () => {
    updateAccountTaxLineMock.mockResolvedValue({ error: "Couldn't save the tax line: denied" });
    render(<TaxLineForm account={account} taxLines={taxLines} properties={properties} />);

    fireEvent.change(screen.getByLabelText("Tax line for Rent"), { target: { value: "line-wages" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Couldn't save the tax line: denied")).toBeInTheDocument();
    const sent = updateAccountTaxLineMock.mock.calls[0][1] as FormData;
    expect(sent.get("taxLineId")).toBe("line-wages");
    await waitFor(() => expect(screen.getByLabelText("Tax line for Rent")).toHaveValue("line-wages"));
  });
});
