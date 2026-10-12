import { afterEach, describe, expect, it } from "vitest";
import { isCronAuthorized } from "@/lib/cron/authorize";

describe("isCronAuthorized", () => {
  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("accepts the configured bearer token", () => {
    process.env.CRON_SECRET = "s3cret";
    expect(isCronAuthorized("Bearer s3cret")).toBe(true);
  });

  it("rejects a wrong or missing token", () => {
    process.env.CRON_SECRET = "s3cret";
    expect(isCronAuthorized("Bearer nope")).toBe(false);
    expect(isCronAuthorized(null)).toBe(false);
  });

  it("fails closed when CRON_SECRET is unset", () => {
    expect(isCronAuthorized("Bearer undefined")).toBe(false);
    expect(isCronAuthorized("Bearer ")).toBe(false);
  });
});
