import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emitHook, getPlugins, getSlotComponents, on, registerPlugin, resetRegistry } from "@/lib/plugins/hooks";
import { enabledPluginIds, ensurePluginsLoaded, isPluginEnabled, resetLoaderState } from "@/lib/plugins/loader";
import type { FOQBPlugin } from "@/lib/plugins/types";

const payload = { invoiceId: "inv-1", invoiceNumber: "1001", customerId: null, total: 100, orgId: "org-1" };

function plugin(id: string, overrides: Partial<FOQBPlugin> = {}): FOQBPlugin {
  return { manifest: { id, name: id, version: "0.0.0", description: "test" }, ...overrides };
}

beforeEach(() => {
  resetRegistry();
  resetLoaderState();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("plugin hooks", () => {
  it("passes the payload to every handler, and unsubscribes", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const off = on("invoice:created", first);
    on("invoice:created", second);

    await emitHook("invoice:created", payload);
    off();
    await emitHook("invoice:created", payload);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledWith(payload);
  });

  it("never lets a failing or hanging handler fail the caller", async () => {
    vi.useFakeTimers();
    const after = vi.fn();
    on("invoice:created", () => {
      throw new Error("boom");
    });
    on("invoice:created", () => new Promise(() => {}));
    on("invoice:created", after);

    const done = emitHook("invoice:created", payload);
    await vi.advanceTimersByTimeAsync(5000);
    await expect(done).resolves.toBeUndefined();
    expect(after).toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledTimes(2);
  });

  it("wires a plugin's hooks and slots once", async () => {
    const hook = vi.fn();
    const Button = () => null;
    const p = plugin("demo", { hooks: { "invoice:created": hook }, slots: { "invoice.actions": Button } });

    registerPlugin(p);
    registerPlugin(p);
    await emitHook("invoice:created", payload);

    expect(hook).toHaveBeenCalledTimes(1);
    expect(getSlotComponents("invoice.actions")).toEqual([Button]);
    expect(getPlugins()).toHaveLength(1);
  });
});

describe("plugin loader", () => {
  it("runs nothing unless the operator turns it on", () => {
    expect(isPluginEnabled("emailer")).toBe(false);
    expect(isPluginEnabled("emailer", true)).toBe(true);

    vi.stubEnv("FOQB_PLUGINS", "emailer, Webhooks");
    expect(isPluginEnabled("emailer")).toBe(true);
    expect(isPluginEnabled("webhooks")).toBe(true);
    expect(isPluginEnabled("ocr", true)).toBe(false);

    vi.stubEnv("FOQB_PLUGINS", "none");
    expect(isPluginEnabled("emailer", true)).toBe(false);
  });

  it("registers only the enabled plugins", () => {
    const available = [plugin("a"), plugin("b"), plugin("c", { manifest: { ...plugin("c").manifest, enabledByDefault: true } })];
    vi.stubEnv("FOQB_PLUGINS", "a");
    expect(enabledPluginIds(available)).toEqual(["a"]);

    ensurePluginsLoaded(["a", "c"], available);
    expect(getPlugins().map((p) => p.manifest.id)).toEqual(["a", "c"]);
  });

  it("ships no plugins", () => {
    expect(enabledPluginIds()).toEqual([]);
  });
});
