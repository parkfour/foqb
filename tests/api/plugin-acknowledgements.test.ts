import { describe, expect, it } from "vitest";
import { createSupabaseMock, ok } from "./supabase-mock";
import { getAllOrgPluginConfigs } from "@/lib/plugins/settings";
import type { FOQBPlugin } from "@/lib/plugins/types";

const payroll: FOQBPlugin = {
  manifest: {
    id: "plugin-a",
    name: "Gated",
    version: "1.0.0",
    description: "Needs acknowledging",
    acknowledgement: { version: "2026-10", title: "Talk to a tax professional", text: ["Really."] },
  },
};

const ack = (organization_id: string | null, version = "2026-10") => ({
  organization_id,
  plugin_id: "plugin-a",
  version,
  acknowledged_by: "u",
  acknowledged_at: "2026-10-25T12:00:00Z",
});

async function configFor(acks: unknown[]) {
  const { client } = createSupabaseMock({
    tables: {
      plugin_data: { select: ok([{ plugin_id: "plugin-a", value: { enabled: true } }]) },
      plugin_acknowledgements: { select: ok(acks) },
    },
  });
  return (await getAllOrgPluginConfigs(client as never, "org-1", [payroll], { "plugin-a": "on" }))["plugin-a"];
}

describe("a plugin that needs acknowledging", () => {
  it("stays off, though the book turned it on, until the instance and the book both acknowledge it", async () => {
    expect((await configFor([])).enabled).toBe(false);
    expect((await configFor([ack(null)])).enabled).toBe(false);
    expect((await configFor([ack("org-1")])).enabled).toBe(false);
    const both = await configFor([ack(null), ack("org-1")]);
    expect(both.enabled).toBe(true);
    expect(both.acknowledgement).toEqual({
      site: { by: "u", at: "2026-10-25T12:00:00Z" },
      book: { by: "u", at: "2026-10-25T12:00:00Z" },
    });
  });

  it("asks again when the disclaimer's version changes", async () => {
    expect((await configFor([ack(null, "2025-01"), ack("org-1", "2025-01")])).enabled).toBe(false);
  });
});
