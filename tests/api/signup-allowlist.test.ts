import { describe, expect, it } from "vitest";
import { isEmailAllowed } from "@/lib/auth/signup-allowlist";

describe("isEmailAllowed", () => {
  it("allows anything when the allowlist is unset", () => {
    expect(isEmailAllowed("anyone@example.com", undefined)).toBe(true);
  });

  it("allows anything when the allowlist is empty", () => {
    expect(isEmailAllowed("anyone@example.com", "")).toBe(true);
    expect(isEmailAllowed("anyone@example.com", "   ")).toBe(true);
  });

  it("matches an exact email, case-insensitively", () => {
    expect(isEmailAllowed("Jimmy@Cheese.com", "jimmy@cheese.com")).toBe(true);
    expect(isEmailAllowed("other@cheese.com", "jimmy@cheese.com")).toBe(false);
  });

  it("matches a wildcard domain pattern, case-insensitively", () => {
    expect(isEmailAllowed("anyone@ragecoding.net", "*@ragecoding.net")).toBe(true);
    expect(isEmailAllowed("anyone@RageCoding.NET", "*@ragecoding.net")).toBe(true);
    expect(isEmailAllowed("anyone@other.net", "*@ragecoding.net")).toBe(false);
  });

  it("rejects an email matching none of the patterns", () => {
    expect(isEmailAllowed("nope@nowhere.com", "jimmy@cheese.com,*@ragecoding.net")).toBe(false);
  });

  it("combines multiple comma-separated patterns, order-independent", () => {
    const allowlist = "jimmy@cheese.com,*@ragecoding.net";
    expect(isEmailAllowed("jimmy@cheese.com", allowlist)).toBe(true);
    expect(isEmailAllowed("someone@ragecoding.net", allowlist)).toBe(true);
    expect(isEmailAllowed(" jimmy@cheese.com , *@ragecoding.net ", "jimmy@cheese.com")).toBe(false);
  });
});
