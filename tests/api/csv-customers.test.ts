import { describe, expect, it } from "vitest";
import { parseCustomersCsv } from "@/lib/csv/customers";

describe("parseCustomersCsv", () => {
  it("parses valid rows", () => {
    const csv = "name,email,phone,billing_address,is_active\nAcme Co,acme@example.com,555-1234,123 Main St,true";
    const { records, errors } = parseCustomersCsv(csv);

    expect(errors).toEqual([]);
    expect(records).toEqual([
      {
        name: "Acme Co",
        email: "acme@example.com",
        phone: "555-1234",
        billing_address: "123 Main St",
        is_active: true,
      },
    ]);
  });

  it("defaults optional fields to null and is_active to true when omitted", () => {
    const csv = "name\nAcme Co";
    const { records } = parseCustomersCsv(csv);

    expect(records[0]).toEqual({
      name: "Acme Co",
      email: null,
      phone: null,
      billing_address: null,
      is_active: true,
    });
  });

  it.each(["false", "FALSE", "no", "0", "inactive"])("treats is_active=%s as inactive", (value) => {
    const csv = `name,is_active\nAcme Co,${value}`;
    const { records } = parseCustomersCsv(csv);
    expect(records[0].is_active).toBe(false);
  });

  it("accepts customer_name as an alternate for name", () => {
    const csv = "customer_name,email\nAcme Co,acme@example.com";
    const { records, errors } = parseCustomersCsv(csv);
    expect(errors).toEqual([]);
    expect(records[0].name).toBe("Acme Co");
  });

  it("rejects a row missing name", () => {
    const csv = "name,email\n,acme@example.com";
    const { records, errors } = parseCustomersCsv(csv);
    expect(records).toEqual([]);
    expect(errors[0]).toMatch(/name is required/i);
  });
});
