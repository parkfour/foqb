import { EventEmitter } from "node:events";
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, ok } from "./supabase-mock";
import { decryptToken, encryptToken } from "@/lib/crypto/token-encryption";

const { adminClientMock, serverClientMock, getCurrentUserRoleMock, httpsRequestMock, afterMock } = vi.hoisted(() => ({
  adminClientMock: vi.fn(),
  serverClientMock: vi.fn(),
  getCurrentUserRoleMock: vi.fn(),
  httpsRequestMock: vi.fn(),
  afterMock: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: adminClientMock }));
vi.mock("@/lib/supabase/server", () => ({ createClient: serverClientMock }));
vi.mock("@/lib/auth/rate-limit", () => ({ checkRateLimit: vi.fn(async () => true) }));
vi.mock("@/lib/org/current", () => ({ getCurrentUserRole: getCurrentUserRoleMock }));
const { bookPlugins } = vi.hoisted(() => ({ bookPlugins: { value: ["webhooks"] } }));
vi.mock("@/lib/plugins/settings", () => ({ getOrgEnabledPluginIds: async () => bookPlugins.value }));
vi.mock("next/server", () => ({ after: afterMock }));
vi.mock("node:https", () => ({ request: httpsRequestMock }));

import { deliverWebhook, enqueueWebhookEvent, postWebhook, signWebhook } from "@/plugins/webhooks/delivery";
import { createWebhook } from "@/plugins/webhooks/actions";
import { enabledPluginJobs, ensureServerPluginsLoaded, resetServerLoaderState } from "@/lib/plugins/server-loader";
import { emitHook, resetRegistry } from "@/lib/plugins/hooks";
import { resetLoaderState } from "@/lib/plugins/loader";

const SECRET = "whsec_test";

// A receiver that answers `status` and remembers what it was sent.
function receiver(status: number) {
  const sent: { url: string; headers: Record<string, string>; body: string }[] = [];
  httpsRequestMock.mockImplementation((url: string, options: { headers: Record<string, string> }, onResponse: (res: unknown) => void) => {
    const req = Object.assign(new EventEmitter(), {
      destroy: vi.fn(),
      end: (body: string) => {
        sent.push({ url, headers: options.headers, body });
        setImmediate(() => onResponse({ statusCode: status, destroy: vi.fn() }));
      },
    });
    return req;
  });
  return sent;
}

function claimed(attempts = 0) {
  return createSupabaseMock({
    tables: {
      webhook_deliveries: {
        update: ok({
          id: "del-1",
          organization_id: "org-1",
          event: "invoice:created",
          payload: { invoiceId: "inv-1", total: 558 },
          attempts,
          created_at: "2026-10-17T12:00:00Z",
          webhook: { url: "https://hooks.example.com/foqb", secret_encrypted: encryptToken(SECRET) },
        }),
      },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUserRoleMock.mockResolvedValue("owner");
});

describe("deliverWebhook", () => {
  it("posts a signed message the receiver can verify", async () => {
    const sent = receiver(200);
    const { client, tables } = claimed();
    adminClientMock.mockReturnValue(client);

    expect(await deliverWebhook("del-1")).toEqual({ delivered: true, status: 200 });

    const [{ url, headers, body }] = sent;
    expect(url).toBe("https://hooks.example.com/foqb");
    expect(JSON.parse(body)).toEqual({
      id: "del-1",
      event: "invoice:created",
      created_at: "2026-10-17T12:00:00Z",
      organization_id: "org-1",
      data: { invoiceId: "inv-1", total: 558 },
    });
    const expected = createHmac("sha256", SECRET).update(`${headers["x-foqb-timestamp"]}.${body}`).digest("hex");
    expect(headers["x-foqb-signature"]).toBe(`sha256=${expected}`);
    expect(headers["x-foqb-event"]).toBe("invoice:created");
    expect(tables.webhook_deliveries.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "delivered", attempts: 1, last_response_status: 200 }),
    );
  });

  it("schedules a retry when the receiver fails", async () => {
    receiver(503);
    const { client, tables } = claimed();
    adminClientMock.mockReturnValue(client);

    expect(await deliverWebhook("del-1")).toEqual({ delivered: false, status: 503 });
    const recorded = tables.webhook_deliveries.update.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(recorded).toMatchObject({ attempts: 1, last_error: "HTTP 503" });
    expect(recorded).not.toHaveProperty("status");
    expect(new Date(recorded.next_attempt_at as string).getTime()).toBeGreaterThan(Date.now() + 50_000);
  });

  it("gives up after the last retry", async () => {
    receiver(500);
    const { client, tables } = claimed(5);
    adminClientMock.mockReturnValue(client);

    await deliverWebhook("del-1");
    expect(tables.webhook_deliveries.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "failed", attempts: 6 }),
    );
  });

  it("does nothing when another run has the delivery", async () => {
    const sent = receiver(200);
    adminClientMock.mockReturnValue(createSupabaseMock({ tables: { webhook_deliveries: { update: ok(null) } } }).client);

    expect(await deliverWebhook("del-1")).toBeNull();
    expect(sent).toHaveLength(0);
  });
});

describe("postWebhook", () => {
  it("signs the timestamp with the body, so a captured message can't be replayed later", () => {
    expect(signWebhook(SECRET, 1, "{}")).not.toBe(signWebhook(SECRET, 2, "{}"));
  });

  it("refuses private and local addresses", async () => {
    const actual = await vi.importActual<typeof import("node:https")>("node:https");
    httpsRequestMock.mockImplementation(actual.request);

    for (const url of ["https://127.0.0.1:9/hook", "https://[::1]:9/hook", "https://localhost:9/hook"]) {
      expect(await postWebhook(url, "{}", {}), url).toMatchObject({
        delivered: false,
        error: expect.stringMatching(/private or local/),
      });
    }
  });
});

describe("enqueueWebhookEvent", () => {
  it("queues one delivery per subscribed webhook and sends them after the response", async () => {
    const { client, tables } = createSupabaseMock({
      tables: {
        organization_webhooks: { select: ok([{ id: "wh-1" }, { id: "wh-2" }]) },
        webhook_deliveries: { insert: ok([{ id: "d1" }, { id: "d2" }]) },
      },
    });
    adminClientMock.mockReturnValue(client);

    await enqueueWebhookEvent("bill:created", { orgId: "org-1", billId: "b-1" } as { orgId: string });

    expect(tables.organization_webhooks.contains).toHaveBeenCalledWith("events", ["bill:created"]);
    expect(tables.webhook_deliveries.insert).toHaveBeenCalledWith([
      { organization_id: "org-1", webhook_id: "wh-1", event: "bill:created", payload: { billId: "b-1" } },
      { organization_id: "org-1", webhook_id: "wh-2", event: "bill:created", payload: { billId: "b-1" } },
    ]);
    expect(afterMock).toHaveBeenCalledTimes(1);
  });

  it("sends nothing from a book that has webhooks turned off, though its webhooks are still saved", async () => {
    const { client, tables } = createSupabaseMock({
      tables: {
        organization_webhooks: { select: ok([{ id: "wh-1" }]) },
        webhook_deliveries: { insert: ok([{ id: "d1" }]) },
      },
    });
    adminClientMock.mockReturnValue(client);
    bookPlugins.value = [];
    try {
      await enqueueWebhookEvent("journal_entry:posted", { orgId: "org-1", journalEntryId: "je-1" } as { orgId: string });
    } finally {
      bookPlugins.value = ["webhooks"];
    }
    expect(tables.webhook_deliveries.insert).not.toHaveBeenCalled();
    expect(afterMock).not.toHaveBeenCalled();
  });
});

describe("server plugin parts", () => {
  beforeEach(() => {
    resetRegistry();
    resetLoaderState();
    resetServerLoaderState();
  });

  it("registers handlers and jobs only for enabled plugins", async () => {
    const handler = vi.fn();
    const parts = { on: { hooks: { "bill:created": handler }, jobs: [{ name: "j", minIntervalSeconds: 60, run: vi.fn() }] }, off: { hooks: { "bill:created": vi.fn() } } };

    ensureServerPluginsLoaded(["on"], parts);
    await emitHook("bill:created", { billId: "b", billNumber: "1", vendorId: null, total: 1, orgId: "o" });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(parts.off.hooks["bill:created"]).not.toHaveBeenCalled();
    expect(enabledPluginJobs(["on"], parts).map((j) => j.name)).toEqual(["j"]);
    expect(enabledPluginJobs([], parts)).toEqual([]);
  });
});

describe("createWebhook", () => {
  function form(fields: Record<string, string | string[]>): FormData {
    const fd = new FormData();
    for (const [key, value] of Object.entries({ organizationId: "org-1", events: ["invoice:created"], ...fields })) {
      for (const v of [value].flat()) fd.append(key, v);
    }
    return fd;
  }

  it("is owner-only", async () => {
    getCurrentUserRoleMock.mockResolvedValue("accountant");
    expect(await createWebhook(null, form({ url: "https://8.8.8.8/hook" }))).toEqual({
      error: "Only an owner can add webhooks.",
    });
  });

  it("refuses http, credentials in the URL, unknown events and private hosts", async () => {
    expect(await createWebhook(null, form({ url: "http://8.8.8.8/hook" }))).toHaveProperty("error");
    expect(await createWebhook(null, form({ url: "https://u:p@8.8.8.8/hook" }))).toHaveProperty("error");
    expect(await createWebhook(null, form({ url: "https://8.8.8.8/hook", events: ["journal:posted"] }))).toHaveProperty("error");
    expect(await createWebhook(null, form({ url: "https://169.254.169.254/latest" }))).toEqual({
      error: expect.stringContaining("private or local"),
    });
    expect(serverClientMock).not.toHaveBeenCalled();
  });

  it("returns the secret once and stores it encrypted", async () => {
    const { client, tables } = createSupabaseMock({
      tables: { organization_webhooks: { select: ok(null), insert: ok(null) } },
    });
    serverClientMock.mockResolvedValue(client);

    const result = await createWebhook(null, form({ url: "https://8.8.8.8/hook" }));
    if (!("secret" in result)) throw new Error(JSON.stringify(result));
    expect(result.secret).toMatch(/^whsec_/);

    const row = tables.organization_webhooks.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(row).toMatchObject({ organization_id: "org-1", url: "https://8.8.8.8/hook", events: ["invoice:created"] });
    expect(decryptToken(row.secret_encrypted as string)).toBe(result.secret);
  });
});
