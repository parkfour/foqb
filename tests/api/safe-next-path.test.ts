import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/http/proxy-headers";

describe("safeNextPath", () => {
  it("keeps paths on this site", () => {
    expect(safeNextPath("/settings")).toBe("/settings");
    expect(safeNextPath("/reports?report=ar-aging")).toBe("/reports?report=ar-aging");
    expect(safeNextPath("/")).toBe("/");
  });

  it("sends anything that could reach another host to /", () => {
    for (const next of ["@evil.com", "//evil.com", "/\\evil.com", "https://evil.com", "evil.com", "/\nx", "", null]) {
      expect(safeNextPath(next)).toBe("/");
    }
  });
});
