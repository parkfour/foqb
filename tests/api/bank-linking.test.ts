import { describe, expect, it } from "vitest";
import { createSupabaseMock, ok } from "./supabase-mock";
import { BANK_LINKING_OFF_ORG, BANK_LINKING_OFF_SITE, bankLinkingBlockedReason } from "@/lib/plaid/bank-linking";

function client(site: boolean, org: boolean | null) {
  return createSupabaseMock({
    tables: {
      site_settings: { select: ok({ signups_enabled: true, bank_linking_enabled: site }) },
      organizations: { select: ok(org === null ? null : { bank_linking_enabled: org }) },
    },
  }).client as never;
}

describe("bankLinkingBlockedReason", () => {
  it("allows connecting when both switches are on", async () => {
    expect(await bankLinkingBlockedReason(client(true, true), "org-1")).toBeNull();
  });

  it("blocks when the Site Admin switch is off, whatever the org says", async () => {
    expect(await bankLinkingBlockedReason(client(false, true), "org-1")).toBe(BANK_LINKING_OFF_SITE);
  });

  it("blocks when the org's own switch is off", async () => {
    expect(await bankLinkingBlockedReason(client(true, false), "org-1")).toBe(BANK_LINKING_OFF_ORG);
  });

  it("blocks when the org can't be read", async () => {
    expect(await bankLinkingBlockedReason(client(true, null), "org-1")).toBe(BANK_LINKING_OFF_ORG);
  });
});
