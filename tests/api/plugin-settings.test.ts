// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  getDefaultPluginSettings,
  mergeSettingsWithDefaults,
  getOrgPluginConfig,
  setOrgPluginConfig,
  getOrgEnabledPluginIds,
  getPluginSettings,
  PLUGIN_CONFIG_KEY,
} from "@/lib/plugins/settings";
import { getSlotComponents, registerSlot, resetRegistry } from "@/lib/plugins/hooks";
import type { FOQBPlugin } from "@/lib/plugins/types";

const testPluginA: FOQBPlugin = {
  manifest: {
    id: "plugin-a",
    name: "Plugin A",
    version: "1.0.0",
    description: "First test plugin",
    enabledByDefault: true,
  },
  settings: [
    {
      key: "text_setting",
      label: "Text Setting",
      type: "text",
      defaultValue: "default text",
    },
    {
      key: "select_setting",
      label: "Select Setting",
      type: "select",
      defaultValue: "opt2",
      options: [
        { value: "opt1", label: "Option 1" },
        { value: "opt2", label: "Option 2" },
      ],
    },
    {
      key: "multiselect_setting",
      label: "Multiselect Setting",
      type: "multiselect",
      defaultValue: ["tag1", "tag2"],
      options: [
        { value: "tag1", label: "Tag 1" },
        { value: "tag2", label: "Tag 2" },
        { value: "tag3", label: "Tag 3" },
      ],
    },
    {
      key: "boolean_setting",
      label: "Boolean Setting",
      type: "boolean",
      defaultValue: true,
    },
    {
      key: "number_setting",
      label: "Number Setting",
      type: "number",
      defaultValue: 42,
    },
  ],
};

const testPluginB: FOQBPlugin = {
  manifest: {
    id: "plugin-b",
    name: "Plugin B",
    version: "1.0.0",
    description: "Second test plugin",
    enabledByDefault: false,
  },
  settings: [
    {
      key: "custom_url",
      label: "Custom URL",
      type: "text",
      placeholder: "https://...",
    },
  ],
};

describe("Plugin Settings Schema & Defaults", () => {
  it("computes default values correctly from schema definitions", () => {
    const defaultsA = getDefaultPluginSettings(testPluginA);
    expect(defaultsA).toEqual({
      text_setting: "default text",
      select_setting: "opt2",
      multiselect_setting: ["tag1", "tag2"],
      boolean_setting: true,
      number_setting: 42,
    });

    const defaultsB = getDefaultPluginSettings(testPluginB);
    expect(defaultsB).toEqual({
      custom_url: "",
    });
  });

  it("merges stored settings with defaults", () => {
    const stored = {
      text_setting: "overridden text",
      multiselect_setting: ["tag3"],
    };
    const merged = mergeSettingsWithDefaults(stored, testPluginA);
    expect(merged.text_setting).toBe("overridden text");
    expect(merged.multiselect_setting).toEqual(["tag3"]);
    expect(merged.number_setting).toBe(42);
    expect(merged.boolean_setting).toBe(true);
  });
});

describe("Organization Plugin Config Storage", () => {
  it("gets org plugin config with defaults when no database record exists", async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }),
        }),
      }),
    };

    const config = await getOrgPluginConfig(mockSupabase as never, "org-1", "plugin-a", [testPluginA]);
    expect(config.enabled).toBe(true);
    expect(config.settings.text_setting).toBe("default text");
    expect(config.settings.number_setting).toBe(42);
  });

  it("retrieves and parses stored org plugin config", async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    value: {
                      enabled: false,
                      settings: {
                        text_setting: "stored text",
                      },
                    },
                    updated_at: "2026-10-23T12:00:00Z",
                  },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }),
    };

    const config = await getOrgPluginConfig(mockSupabase as never, "org-1", "plugin-a", [testPluginA]);
    expect(config.enabled).toBe(false);
    expect(config.settings.text_setting).toBe("stored text");
    // Non-overridden fallback to defaults
    expect(config.settings.number_setting).toBe(42);
    expect(config.updatedAt).toBe("2026-10-23T12:00:00Z");
  });

  it("saves plugin config with setOrgPluginConfig", async () => {
    const upsertFn = vi.fn().mockResolvedValue({ error: null });
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        upsert: upsertFn,
      }),
    };

    await setOrgPluginConfig(
      mockSupabase as never,
      "org-1",
      "plugin-a",
      {
        enabled: true,
        settings: { text_setting: "new value" },
      },
      [testPluginA],
    );

    expect(upsertFn).toHaveBeenCalledWith(
      {
        organization_id: "org-1",
        plugin_id: "plugin-a",
        key: PLUGIN_CONFIG_KEY,
        value: {
          enabled: true,
          settings: expect.objectContaining({
            text_setting: "new value",
            number_setting: 42,
          }),
        },
      },
      { onConflict: "organization_id,plugin_id,key" },
    );
  });

  it("getPluginSettings returns typed settings directly", async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    value: {
                      enabled: true,
                      settings: {
                        text_setting: "direct test",
                      },
                    },
                  },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }),
    };

    const settings = await getPluginSettings<{ text_setting: string }>(
      mockSupabase as never,
      "org-1",
      "plugin-a",
      [testPluginA],
    );
    expect(settings.text_setting).toBe("direct test");
  });
});

describe("Which plugins a book runs", () => {
  const noRows = { from: () => ({ select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }) }) };

  it("starts every plugin the operator listed on, whatever its instance default", async () => {
    vi.stubEnv("FOQB_PLUGINS", "plugin-a,plugin-b");
    try {
      const ids = await getOrgEnabledPluginIds(noRows as never, "org-1", [testPluginA, testPluginB]);
      expect(ids).toEqual(["plugin-a", "plugin-b"]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("keeps a plugin the instance doesn't run off for the book", async () => {
    vi.stubEnv("FOQB_PLUGINS", "none");
    try {
      const config = await getOrgPluginConfig(noRows as never, "org-1", "plugin-a", [testPluginA]);
      expect(config.enabled).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("Slot filtering by organization-enabled plugins", () => {
  beforeEach(() => {
    resetRegistry();
  });

  it("filters slot components by enabled plugin IDs", () => {
    const ComponentA = () => null;
    const ComponentB = () => null;

    registerSlot("invoice.actions", ComponentA as never, "plugin-a");
    registerSlot("invoice.actions", ComponentB as never, "plugin-b");

    // When both are enabled
    expect(getSlotComponents("invoice.actions", ["plugin-a", "plugin-b"])).toEqual([
      ComponentA,
      ComponentB,
    ]);

    // When only plugin-a is enabled
    expect(getSlotComponents("invoice.actions", ["plugin-a"])).toEqual([ComponentA]);

    // When neither is enabled
    expect(getSlotComponents("invoice.actions", [])).toEqual([]);

    // When no filter is supplied (fallback)
    expect(getSlotComponents("invoice.actions")).toEqual([ComponentA, ComponentB]);
  });
});
