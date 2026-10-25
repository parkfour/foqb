import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fromMinorUnits, isStripeSecretKey, toMinorUnits, verifyStripeSignature } from "@/plugins/stripe-payments/stripe";

const secret = "whsec_test123";
const sign = (body: string, t: number, key = secret) =>
  `t=${t},v1=${createHmac("sha256", key).update(`${t}.${body}`).digest("hex")}`;

describe("stripe payments", () => {
  it("accepts Stripe's signature and refuses a wrong, stale or missing one", () => {
    const body = '{"type":"checkout.session.completed"}';
    const now = 1_800_000_000_000;
    const t = now / 1000;
    expect(verifyStripeSignature(body, sign(body, t), secret, now)).toBe(true);
    expect(verifyStripeSignature(body, `t=${t},v1=deadbeef,${sign(body, t).split(",")[1]}`, secret, now)).toBe(true);
    expect(verifyStripeSignature(body + " ", sign(body, t), secret, now)).toBe(false);
    expect(verifyStripeSignature(body, sign(body, t, "whsec_other"), secret, now)).toBe(false);
    expect(verifyStripeSignature(body, sign(body, t - 600), secret, now)).toBe(false);
    expect(verifyStripeSignature(body, null, secret, now)).toBe(false);
  });

  it("counts most currencies in cents and zero-decimal ones in whole units", () => {
    expect(toMinorUnits(106.25, "USD")).toBe(10625);
    expect(toMinorUnits(15000, "KRW")).toBe(15000);
    expect(fromMinorUnits(10625, "usd")).toBe(106.25);
    expect(fromMinorUnits(1500, "jpy")).toBe(1500);
  });

  it("knows a secret or restricted key", () => {
    expect(isStripeSecretKey("sk_test_51Habcdefghij")).toBe(true);
    expect(isStripeSecretKey("rk_live_51Habcdefghij")).toBe(true);
    expect(isStripeSecretKey("pk_live_51Habcdefghij")).toBe(false);
  });
});
