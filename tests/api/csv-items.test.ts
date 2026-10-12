import { describe, expect, it } from "vitest";
import { parseItemsCsv } from "@/lib/csv/items";

describe("parseItemsCsv", () => {
  it("parses valid rows", () => {
    const csv =
      "name,description,income_account_number,sale_price,track_quantity,quantity_on_hand,is_active\n" +
      "Widget,A widget,4000,25.5,true,10,true";
    const { records, errors } = parseItemsCsv(csv);

    expect(errors).toEqual([]);
    expect(records).toEqual([
      {
        name: "Widget",
        description: "A widget",
        income_account_number: "4000",
        sale_price: 25.5,
        track_quantity: true,
        quantity_on_hand: 10,
        is_active: true,
      },
    ]);
  });

  it("defaults optional fields when omitted", () => {
    const csv = "name,income_account_number\nWidget,4000";
    const { records } = parseItemsCsv(csv);

    expect(records[0]).toEqual({
      name: "Widget",
      description: null,
      income_account_number: "4000",
      sale_price: null,
      track_quantity: false,
      quantity_on_hand: 0,
      is_active: true,
    });
  });

  it("accepts item_name as an alternate for name", () => {
    const csv = "item_name,income_account_number\nWidget,4000";
    const { records, errors } = parseItemsCsv(csv);
    expect(errors).toEqual([]);
    expect(records[0].name).toBe("Widget");
  });

  it("rejects a row missing name or income_account_number", () => {
    const csvNoName = "name,income_account_number\n,4000";
    expect(parseItemsCsv(csvNoName).errors[0]).toMatch(/required/i);
    expect(parseItemsCsv(csvNoName).records).toEqual([]);

    const csvNoAccount = "name,income_account_number\nWidget,";
    expect(parseItemsCsv(csvNoAccount).errors[0]).toMatch(/required/i);
    expect(parseItemsCsv(csvNoAccount).records).toEqual([]);
  });

  it("rejects an invalid sale_price", () => {
    const csv = "name,income_account_number,sale_price\nWidget,4000,not-a-number";
    const { records, errors } = parseItemsCsv(csv);
    expect(records).toEqual([]);
    expect(errors[0]).toMatch(/invalid sale_price/i);
  });

  it("rejects an invalid quantity_on_hand", () => {
    const csv = "name,income_account_number,quantity_on_hand\nWidget,4000,not-a-number";
    const { records, errors } = parseItemsCsv(csv);
    expect(records).toEqual([]);
    expect(errors[0]).toMatch(/invalid quantity_on_hand/i);
  });

  it.each(["true", "yes", "y", "1"])("treats track_quantity=%s as true", (value) => {
    const csv = `name,income_account_number,track_quantity\nWidget,4000,${value}`;
    const { records } = parseItemsCsv(csv);
    expect(records[0].track_quantity).toBe(true);
  });

  it.each(["false", "no", "0", ""])("treats track_quantity=%s as false", (value) => {
    const csv = `name,income_account_number,track_quantity\nWidget,4000,${value}`;
    const { records } = parseItemsCsv(csv);
    expect(records[0].track_quantity).toBe(false);
  });
});
