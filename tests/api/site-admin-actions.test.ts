import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, fail, ok } from "./supabase-mock";

const { serverClientMock, adminClientMock, removeItemMock } = vi.hoisted(() => ({
  serverClientMock: vi.fn(),
  adminClientMock: vi.fn(),
  removeItemMock: vi.fn(),
}));

vi.mock("@/lib/plaid/client", () => ({ removeItem: removeItemMock }));

vi.mock("@/lib/supabase/server", () => ({ createClient: serverClientMock }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: adminClientMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { encryptToken } from "@/lib/crypto/token-encryption";
import { createSiteAdminAccount, deleteOrganization, demoteSiteAdmin } from "@/app/(site-admin)/site-admin/actions";

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

// isSiteAdmin() (lib/org/site-admin.ts) calls createClient() again
// internally — the mocked module returns the same caller client both
// times, so configuring its site_admins.select is what drives the gate.
function mockCallerIsSiteAdmin(isAdmin: boolean) {
  const { client } = createSupabaseMock({
    user: { id: "caller-1" },
    tables: {
      site_admins: { select: ok(isAdmin ? { user_id: "caller-1" } : null) },
    },
  });
  serverClientMock.mockResolvedValue(client);
}

describe("createSiteAdminAccount", () => {
  beforeEach(() => {
    serverClientMock.mockReset();
    adminClientMock.mockReset();
  });

  it("rejects a non-site-admin", async () => {
    mockCallerIsSiteAdmin(false);

    const result = await createSiteAdminAccount(
      { error: null },
      formData({ email: "new-admin@example.com" }),
    );

    expect(result.error).toBe("Only a Site Admin can create Site Admin accounts");
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("lets a site admin create another and returns the generated password once", async () => {
    mockCallerIsSiteAdmin(true);

    const createUser = vi.fn(async () => ({
      data: { user: { id: "new-admin-1" } },
      error: null,
    }));
    const { client: admin } = createSupabaseMock({
      tables: {
        signup_exemptions: {},
        site_admins: { insert: ok(null) },
        pending_member_accounts: { insert: ok(null) },
      },
      authAdmin: { createUser },
    });
    adminClientMock.mockReturnValue(admin);

    const result = await createSiteAdminAccount(
      { error: null },
      formData({ email: "new-admin@example.com" }),
    );

    expect(result.error).toBeNull();
    expect(result.credentials?.email).toBe("new-admin@example.com");
    expect(result.credentials?.password).toBeTruthy();
    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "new-admin@example.com",
        password: result.credentials?.password,
      }),
    );
  });

  it("rolls back the auth user if the site_admins insert fails", async () => {
    mockCallerIsSiteAdmin(true);

    const createUser = vi.fn(async () => ({
      data: { user: { id: "new-admin-1" } },
      error: null,
    }));
    const deleteUser = vi.fn(async () => ({ data: null, error: null }));
    const { client: admin } = createSupabaseMock({
      tables: {
        signup_exemptions: {},
        site_admins: { insert: fail("duplicate key") },
      },
      authAdmin: { createUser, deleteUser },
    });
    adminClientMock.mockReturnValue(admin);

    const result = await createSiteAdminAccount(
      { error: null },
      formData({ email: "new-admin@example.com" }),
    );

    expect(result.error).toBe("duplicate key");
    expect(deleteUser).toHaveBeenCalledWith("new-admin-1");
  });
});

describe("demoteSiteAdmin", () => {
  beforeEach(() => {
    serverClientMock.mockReset();
  });

  it("removes a site admin", async () => {
    const { client, tables } = createSupabaseMock({
      tables: { site_admins: { delete: ok(null) } },
    });
    serverClientMock.mockResolvedValue(client);

    const result = await demoteSiteAdmin({ error: null }, formData({ userId: "admin-2" }));

    expect(result).toEqual({ error: null });
    expect(tables.site_admins.delete).toHaveBeenCalled();
  });

  it("surfaces the last-site-admin-removal guard as a readable error", async () => {
    const { client } = createSupabaseMock({
      tables: { site_admins: { delete: fail("Cannot remove the last Site Admin") } },
    });
    serverClientMock.mockResolvedValue(client);

    const result = await demoteSiteAdmin({ error: null }, formData({ userId: "admin-2" }));

    expect(result.error).toBe("Cannot remove the last Site Admin");
  });
});

describe("deleteOrganization", () => {
  beforeEach(() => {
    serverClientMock.mockReset();
    adminClientMock.mockReset();
    removeItemMock.mockReset();
    removeItemMock.mockResolvedValue(undefined);
  });

  function mockSiteAdmin(rpcResult: ReturnType<typeof ok> | ReturnType<typeof fail>) {
    const { client } = createSupabaseMock({
      user: { id: "caller-1" },
      tables: { site_admins: { select: ok({ user_id: "caller-1" }) } },
      rpcs: { delete_organization: rpcResult },
    });
    serverClientMock.mockResolvedValue(client);
    const { client: admin, tables } = createSupabaseMock({
      tables: {
        enrollments: {
          select: ok([{ access_token: encryptToken("tok-1") }, { access_token: encryptToken("tok-2") }]),
        },
      },
    });
    adminClientMock.mockReturnValue(admin);
    return { client, tables };
  }

  it("removes every live Plaid Item of the org after deleting it", async () => {
    const { client, tables } = mockSiteAdmin(ok(null));

    const result = await deleteOrganization({ error: null }, formData({ id: "org-1" }));

    expect(result.error).toBeNull();
    expect(client.rpc).toHaveBeenCalledWith("delete_organization", { p_org_id: "org-1" });
    expect(tables.enrollments.eq).toHaveBeenCalledWith("organization_id", "org-1");
    expect(removeItemMock.mock.calls).toEqual([["tok-1"], ["tok-2"]]);
  });

  it("leaves Plaid alone when the delete fails", async () => {
    mockSiteAdmin(fail("Only a Site Admin can delete an organization"));

    const result = await deleteOrganization({ error: null }, formData({ id: "org-1" }));

    expect(result.error).toMatch(/Site Admin/);
    expect(removeItemMock).not.toHaveBeenCalled();
  });

  it("refuses a non-site-admin before reading any tokens", async () => {
    mockCallerIsSiteAdmin(false);

    const result = await deleteOrganization({ error: null }, formData({ id: "org-1" }));

    expect(result.error).toMatch(/Site Admin/);
    expect(adminClientMock).not.toHaveBeenCalled();
  });
});
