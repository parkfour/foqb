import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createSupabaseMock, ok } from "./supabase-mock";
import { encryptToken } from "@/lib/crypto/token-encryption";

const { serverClientMock, adminClientMock, createLinkTokenMock, syncItemMock, blockedReasonMock } = vi.hoisted(() => ({
  serverClientMock: vi.fn(),
  adminClientMock: vi.fn(),
  createLinkTokenMock: vi.fn(),
  syncItemMock: vi.fn(),
  blockedReasonMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: serverClientMock }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: adminClientMock }));
vi.mock("@/lib/plaid/client", () => ({ createLinkToken: createLinkTokenMock }));
vi.mock("@/lib/plaid/sync", () => ({ syncItem: syncItemMock }));
vi.mock("@/lib/plaid/bank-linking", () => ({ bankLinkingBlockedReason: blockedReasonMock }));

import { POST as linkToken } from "@/app/api/plaid/link-token/route";
import { POST as reconnect } from "@/app/api/bank/reconnect/route";

function request(path: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    ...(body ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}),
  });
}

const enrollment = { id: "enr-1", organization_id: "org-1", external_item_id: "item-1" };

function mockUser(role: "owner" | "viewer" | null, aal: "aal1" | "aal2" = "aal2") {
  const { client, tables } = createSupabaseMock({
    user: { id: "user-1" },
    aal,
    tables: {
      enrollments: { select: ok(enrollment), update: ok(null) },
      organization_members: { select: ok(role ? { role } : null) },
    },
  });
  serverClientMock.mockResolvedValue(client);
  const { client: admin } = createSupabaseMock({
    tables: { enrollments: { select: ok({ access_token: encryptToken("access-tok") }) } },
  });
  adminClientMock.mockReturnValue(admin);
  return tables;
}

describe("Plaid update mode (reconnecting a bank)", () => {
  beforeEach(() => {
    serverClientMock.mockReset();
    adminClientMock.mockReset();
    createLinkTokenMock.mockReset();
    syncItemMock.mockReset();
    createLinkTokenMock.mockResolvedValue("link-tok");
    syncItemMock.mockResolvedValue(undefined);
    blockedReasonMock.mockReset().mockResolvedValue(null);
  });

  it("creates a normal link token for an organization when no enrollment is given", async () => {
    mockUser("owner");

    const response = await linkToken(request("/api/plaid/link-token", { organizationId: "org-1" }));

    expect(response.status).toBe(200);
    expect(blockedReasonMock).toHaveBeenCalledWith(expect.anything(), "org-1");
    expect(createLinkTokenMock).toHaveBeenCalledWith("user-1", undefined);
  });

  it("needs an organization or an enrollment to make a link token", async () => {
    mockUser("owner");

    const response = await linkToken(request("/api/plaid/link-token"));

    expect(response.status).toBe(400);
    expect(createLinkTokenMock).not.toHaveBeenCalled();
  });

  it("refuses a link token (new or update mode) while connecting banks is turned off", async () => {
    mockUser("owner");
    blockedReasonMock.mockResolvedValue("Connecting banks is turned off for this organization.");

    const fresh = await linkToken(request("/api/plaid/link-token", { organizationId: "org-1" }));
    const update = await linkToken(request("/api/plaid/link-token", { enrollmentId: "enr-1" }));

    expect(fresh.status).toBe(403);
    expect(update.status).toBe(403);
    // Update mode checks the enrollment's own org, not one the caller names.
    expect(blockedReasonMock).toHaveBeenLastCalledWith(expect.anything(), "org-1");
    expect(createLinkTokenMock).not.toHaveBeenCalled();
  });

  it("refuses reconnecting while connecting banks is turned off", async () => {
    const tables = mockUser("owner");
    blockedReasonMock.mockResolvedValue("Connecting banks is turned off on this instance.");

    const response = await reconnect(request("/api/bank/reconnect", { enrollmentId: "enr-1" }));

    expect(response.status).toBe(403);
    expect(tables.enrollments.update).not.toHaveBeenCalled();
  });

  it("creates an update-mode token from the enrollment's decrypted access token for a writer", async () => {
    mockUser("owner");

    const response = await linkToken(request("/api/plaid/link-token", { enrollmentId: "enr-1" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ linkToken: "link-tok" });
    expect(createLinkTokenMock).toHaveBeenCalledWith("user-1", "access-tok");
  });

  it("refuses an update-mode token to a viewer", async () => {
    mockUser("viewer");

    const response = await linkToken(request("/api/plaid/link-token", { enrollmentId: "enr-1" }));

    expect(response.status).toBe(403);
    expect(adminClientMock).not.toHaveBeenCalled();
    expect(createLinkTokenMock).not.toHaveBeenCalled();
  });

  it("marks the enrollment active after reconnecting, then catches up the sync", async () => {
    const tables = mockUser("owner");

    const response = await reconnect(request("/api/bank/reconnect", { enrollmentId: "enr-1" }));

    expect(response.status).toBe(200);
    expect(tables.enrollments.update).toHaveBeenCalledWith({ status: "active", disconnect_reason: null });
    expect(tables.enrollments.neq).toHaveBeenCalledWith("status", "disconnected");
    expect(syncItemMock).toHaveBeenCalledWith("item-1");
  });

  it("still succeeds if the catch-up sync fails", async () => {
    mockUser("owner");
    syncItemMock.mockRejectedValue(new Error("Plaid down"));

    const response = await reconnect(request("/api/bank/reconnect", { enrollmentId: "enr-1" }));

    expect(response.status).toBe(200);
  });

  it("refuses reconnecting for a viewer", async () => {
    const tables = mockUser("viewer");

    const response = await reconnect(request("/api/bank/reconnect", { enrollmentId: "enr-1" }));

    expect(response.status).toBe(403);
    expect(tables.enrollments.update).not.toHaveBeenCalled();
  });

  it("refuses a link token (new or update mode) without two-factor", async () => {
    mockUser("owner", "aal1");

    const fresh = await linkToken(request("/api/plaid/link-token"));
    const update = await linkToken(request("/api/plaid/link-token", { enrollmentId: "enr-1" }));

    expect(fresh.status).toBe(403);
    expect(update.status).toBe(403);
    await expect(fresh.json()).resolves.toEqual({ error: expect.stringMatching(/two-factor/) });
    expect(createLinkTokenMock).not.toHaveBeenCalled();
  });

  it("refuses reconnecting without two-factor", async () => {
    const tables = mockUser("owner", "aal1");

    const response = await reconnect(request("/api/bank/reconnect", { enrollmentId: "enr-1" }));

    expect(response.status).toBe(403);
    expect(tables.enrollments.update).not.toHaveBeenCalled();
  });
});
