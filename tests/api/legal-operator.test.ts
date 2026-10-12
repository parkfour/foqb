import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getOperatorInfo } from "@/lib/legal/operator";

const ENV_KEYS = ["LEGAL_OPERATOR_NAME", "LEGAL_CONTACT_EMAIL", "LEGAL_JURISDICTION"] as const;
const originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    originalEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe("getOperatorInfo", () => {
  it("returns null when no operator env vars are configured (fresh self-hosted clone)", () => {
    expect(getOperatorInfo()).toBeNull();
  });

  it("returns null when only some env vars are set", () => {
    process.env.LEGAL_OPERATOR_NAME = "Park Four, LLC";
    process.env.LEGAL_CONTACT_EMAIL = "operator@example.com";
    // LEGAL_JURISDICTION intentionally left unset
    expect(getOperatorInfo()).toBeNull();
  });

  it("returns the configured operator once all three are set", () => {
    process.env.LEGAL_OPERATOR_NAME = "Park Four, LLC";
    process.env.LEGAL_CONTACT_EMAIL = "operator@example.com";
    process.env.LEGAL_JURISDICTION = "the State of Florida";

    expect(getOperatorInfo()).toEqual({
      name: "Park Four, LLC",
      contactEmail: "operator@example.com",
      jurisdiction: "the State of Florida",
    });
  });
});
