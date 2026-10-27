import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { enablePluginsForNewBook } from "@/lib/plugins/settings";
import { availablePlugins } from "@/plugins";

function client() {
  const upserts: { plugin_id: string; value: { enabled: boolean } }[] = [];
  const supabase = {
    from: () => ({ upsert: async (row: (typeof upserts)[number]) => (upserts.push(row), { error: null }) }),
  } as unknown as SupabaseClient;
  return { supabase, upserts };
}

describe("a new book's plugins", () => {
  it("starts with the start-up assistant on while the site offers it", async () => {
    for (const mode of ["choose", "on"] as const) {
      const { supabase, upserts } = client();
      await enablePluginsForNewBook(supabase, "org", availablePlugins, { "startup-assistant": mode });
      expect(upserts.map((u) => [u.plugin_id, u.value.enabled])).toEqual([["startup-assistant", true]]);
    }
  });

  it("leaves it off when the site turned it off", async () => {
    const { supabase, upserts } = client();
    await enablePluginsForNewBook(supabase, "org", availablePlugins, { "startup-assistant": "off" });
    expect(upserts).toEqual([]);
  });
});
