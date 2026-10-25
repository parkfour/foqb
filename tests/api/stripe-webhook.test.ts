import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createSupabaseMock, ok } from "./supabase-mock";
import { encryptToken } from "@/lib/crypto/token-encryption";

const { adminClientMock, deactivateMock } = vi.hoisted(() => ({ adminClientMock: vi.fn(), deactivateMock: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: adminClientMock }));
vi.mock("@/lib/plugins/loader", () => ({ enabledPluginIds: () => ["stripe-payments"], ensurePluginsLoaded: vi.fn() }));
vi.mock("@/lib/plugins/settings", () => ({ getOrgEnabledPluginIds: async () => ["stripe-payments"] }));
vi.mock("@/lib/org/control-accounts", () => ({ findAccountsReceivableAccount: async () => ({ id: "ar-1" }) }));
vi.mock("@/lib/plugins/server-loader", () => ({ ensureServerPluginsLoaded: vi.fn() }));
vi.mock("@/lib/plugins/hooks", () => ({ emitHook: vi.fn() }));
vi.mock("@/plugins/stripe-payments/stripe", async (actual) => ({
  ...(await actual<typeof import("@/plugins/stripe-payments/stripe")>()),
  deactivatePaymentLink: deactivateMock,
}));

import { POST } from "@/app/api/stripe/webhook/[orgId]/route";

const whsec = "whsec_abc123";

function request(event: unknown, secret = whsec) {
  const body = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return new NextRequest("https://foqb.example/api/stripe/webhook/org-1", {
    method: "POST",
    body,
    headers: { "stripe-signature": `t=${t},v1=${sig}` },
  });
}

const paid = {
  type: "checkout.session.completed",
  data: { object: { payment_link: "plink_1", payment_status: "paid", amount_total: 10625, currency: "usd" } },
};

function mockAdmin(linkStatus = "open", rpcResult = ok({ id: "pay-1", status: "paid" })) {
  const { client, tables } = createSupabaseMock({
    tables: {
      organization_stripe_settings: {
        select: ok({ secret_key: encryptToken("sk_test_x"), webhook_secret: encryptToken(whsec), deposit_account_id: "stripe-bal" }),
      },
      invoice_payment_links: { select: ok({ id: "link-1", invoice_id: "inv-1", status: linkStatus }), update: ok(null) },
      organizations: { select: ok({ timezone: "America/Chicago" }) },
    },
    rpcs: { record_invoice_payment: rpcResult },
  });
  adminClientMock.mockReturnValue(client);
  return { client, tables };
}

const params = { params: Promise.resolve({ orgId: "org-1" }) };

describe("POST /api/stripe/webhook/[orgId]", () => {
  beforeEach(() => {
    adminClientMock.mockReset();
    deactivateMock.mockReset();
    deactivateMock.mockResolvedValue(undefined);
  });

  it("records a paid link's payment against its invoice, once", async () => {
    const { client, tables } = mockAdmin();
    const res = await POST(request(paid), params);

    expect(await res.json()).toEqual({ received: true, recorded: true });
    expect(client.rpc).toHaveBeenCalledWith(
      "record_invoice_payment",
      expect.objectContaining({ p_invoice_id: "inv-1", p_amount: 106.25, p_deposit_account_id: "stripe-bal", p_ar_account_id: "ar-1" }),
    );
    expect(tables.invoice_payment_links.update).toHaveBeenCalledWith({ status: "paid", invoice_payment_id: "pay-1" });
    expect(deactivateMock).toHaveBeenCalledWith("sk_test_x", "plink_1");
  });

  it("ignores a link already recorded, and refuses a bad signature", async () => {
    const { client } = mockAdmin("paid");
    expect(await (await POST(request(paid), params)).json()).toEqual({ received: true });
    expect(client.rpc).not.toHaveBeenCalled();

    mockAdmin();
    expect((await POST(request(paid, "whsec_wrong"), params)).status).toBe(400);
  });
});
