import { describe, expect, it } from "vitest";
import { parseVendorsCsv } from "@/lib/csv/vendors";

describe("parseVendorsCsv", () => {
  it("parses valid rows", () => {
    const csv = "name,email,phone,address,is_active\nOffice Supply Co,os@example.com,555-5678,456 Oak Ave,true";
    const { records, errors } = parseVendorsCsv(csv);

    expect(errors).toEqual([]);
    expect(records).toEqual([
      {
        name: "Office Supply Co",
        email: "os@example.com",
        phone: "555-5678",
        address: "456 Oak Ave",
        is_active: true,
      },
    ]);
  });

  it("defaults optional fields to null and is_active to true when omitted", () => {
    const csv = "name\nOffice Supply Co";
    const { records } = parseVendorsCsv(csv);

    expect(records[0]).toEqual({
      name: "Office Supply Co",
      email: null,
      phone: null,
      address: null,
      is_active: true,
    });
  });

  it.each(["false", "no", "0", "inactive"])("treats is_active=%s as inactive", (value) => {
    const csv = `name,is_active\nOffice Supply Co,${value}`;
    const { records } = parseVendorsCsv(csv);
    expect(records[0].is_active).toBe(false);
  });

  it("accepts vendor_name as an alternate for name", () => {
    const csv = "vendor_name,email\nOffice Supply Co,os@example.com";
    const { records, errors } = parseVendorsCsv(csv);
    expect(errors).toEqual([]);
    expect(records[0].name).toBe("Office Supply Co");
  });

  it("rejects a row missing name", () => {
    const csv = "name,email\n,os@example.com";
    const { records, errors } = parseVendorsCsv(csv);
    expect(records).toEqual([]);
    expect(errors[0]).toMatch(/name is required/i);
  });
});
