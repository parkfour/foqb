import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, ok } from "./supabase-mock";
import { encryptToken } from "@/lib/crypto/token-encryption";

const { serverClientMock, adminClientMock, removeItemMock } = vi.hoisted(() => ({
  serverClientMock: vi.fn(),
  adminClientMock: vi.fn(),
  removeItemMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: serverClientMock }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: adminClientMock }));
vi.mock("@/lib/plaid/client", () => ({ removeItem: removeItemMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { disconnectEnrollment } from "@/app/(dashboard)/settings/actions";

function formData(id: string): FormData {
  const fd = new FormData();
  fd.set("id", id);
  return fd;
}

function mockCaller(role: "owner" | "viewer", provider: "plaid" | "simplefin" = "plaid") {
  const { client, tables } = createSupabaseMock({
    user: { id: "caller-1" },
    tables: {
      enrollments: { select: ok({ id: "enr-1", organization_id: "org-1" }), update: ok(null) },
      organization_members: { select: ok({ role }) },
    },
  });
  serverClientMock.mockResolvedValue(client);
  const { client: admin } = createSupabaseMock({
    tables: { enrollments: { select: ok({ access_token: encryptToken("tok"), provider }) } },
  });
  adminClientMock.mockReturnValue(admin);
  return tables;
}

describe("disconnectEnrollment", () => {
  beforeEach(() => {
    serverClientMock.mockReset();
    adminClientMock.mockReset();
    removeItemMock.mockReset();
  });

  it("removes the Plaid Item (token read server-side) and marks the enrollment disconnected", async () => {
    const tables = mockCaller("owner");

    await disconnectEnrollment(formData("enr-1"));

    expect(removeItemMock).toHaveBeenCalledWith("tok");
    expect(tables.enrollments.update).toHaveBeenCalledWith({
      status: "disconnected",
      disconnect_reason: "User disconnected",
    });
    expect(tables.enrollments.select).not.toHaveBeenCalledWith("access_token");
  });

  it("only marks a SimpleFIN connection disconnected: there's no Plaid Item to remove", async () => {
    const tables = mockCaller("owner", "simplefin");

    await disconnectEnrollment(formData("enr-1"));

    expect(removeItemMock).not.toHaveBeenCalled();
    expect(tables.enrollments.update).toHaveBeenCalledWith({
      status: "disconnected",
      disconnect_reason: "User disconnected",
    });
  });

  it("does nothing for a viewer", async () => {
    const tables = mockCaller("viewer");

    await disconnectEnrollment(formData("enr-1"));

    expect(adminClientMock).not.toHaveBeenCalled();
    expect(removeItemMock).not.toHaveBeenCalled();
    expect(tables.enrollments.update).not.toHaveBeenCalled();
  });
});
