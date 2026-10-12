import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken } from "@/lib/crypto/token-encryption";

describe("token-encryption", () => {
  it("round-trips a plaintext token", () => {
    const encrypted = encryptToken("tok_secret_value");
    expect(encrypted).not.toBe("tok_secret_value");
    expect(decryptToken(encrypted)).toBe("tok_secret_value");
  });

  it("produces different ciphertext for the same plaintext each time (random IV)", () => {
    const first = encryptToken("same-value");
    const second = encryptToken("same-value");
    expect(first).not.toBe(second);
    expect(decryptToken(first)).toBe("same-value");
    expect(decryptToken(second)).toBe("same-value");
  });

  it("rejects tampered ciphertext", () => {
    const encrypted = encryptToken("tok_secret_value");
    const bytes = Buffer.from(encrypted, "base64");
    bytes[bytes.length - 1] ^= 0xff; // flip a bit in the ciphertext
    const tampered = bytes.toString("base64");

    expect(() => decryptToken(tampered)).toThrow();
  });
});
