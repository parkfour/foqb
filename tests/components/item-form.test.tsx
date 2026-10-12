import { describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach } from "vitest";

const { createItemMock, updateItemMock } = vi.hoisted(() => ({
  createItemMock: vi.fn(),
  updateItemMock: vi.fn(),
}));

vi.mock("@/app/(dashboard)/items/actions", () => ({
  createItem: createItemMock,
  updateItem: updateItemMock,
}));

import { ItemForm } from "@/components/items/item-form";

const accounts = [{ id: "acc-1", account_number: "4000", name: "Sales" }];

afterEach(() => {
  cleanup();
});

describe("ItemForm", () => {
  it("renders in add mode with no quantity field until tracking is enabled", () => {
    render(<ItemForm organizationId="org-1" accounts={accounts} />);

    expect(screen.getByRole("heading", { name: "Add Item" })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Quantity on hand")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: /track quantity/i }));

    expect(screen.getByPlaceholderText("Quantity on hand")).toBeInTheDocument();
  });

  it("renders in edit mode pre-filled from the given item", () => {
    render(
      <ItemForm
        organizationId="org-1"
        accounts={accounts}
        item={{
          id: "item-1",
          name: "Widget",
          description: "A widget",
          income_account_id: "acc-1",
          sale_price: 25,
          track_quantity: true,
          quantity_on_hand: 10,
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "Edit Item" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Widget")).toBeInTheDocument();
    expect(screen.getByDisplayValue("10")).toBeInTheDocument();
  });
});
