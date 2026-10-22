import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, fail, ok } from "./supabase-mock";

const { serverClientMock, adminClientMock, checkRateLimitMock } = vi.hoisted(() => ({
  serverClientMock: vi.fn(),
  adminClientMock: vi.fn(),
  checkRateLimitMock: vi.fn(),
}));

vi.mock("@/lib/auth/rate-limit", () => ({ checkRateLimit: checkRateLimitMock }));

vi.mock("@/lib/supabase/server", () => ({ createClient: serverClientMock }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: adminClientMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { createMemberAccount, regenerateMemberPassword } from "@/app/(dashboard)/settings/actions";

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

// getCurrentUserRole (lib/org/current.ts) calls createClient() again
// internally — the mocked module returns the same caller client both times,
// so configuring its organization_members.select is what drives the
// owner-only gate in both actions under test here.
function mockCallerRole(role: "owner" | "accountant" | "viewer" | null) {
  const { client } = createSupabaseMock({
    user: { id: "caller-1" },
    tables: {
      organization_members: { select: ok(role ? { role } : null) },
    },
  });
  serverClientMock.mockResolvedValue(client);
}

describe("createMemberAccount owner gate", () => {
  beforeEach(() => {
    serverClientMock.mockReset();
    adminClientMock.mockReset();
    checkRateLimitMock.mockReset();
    checkRateLimitMock.mockResolvedValue(true);
  });

  it("stops an owner who has hit the creation rate limit (email-probing cap)", async () => {
    mockCallerRole("owner");
    checkRateLimitMock.mockResolvedValue(false);

    const result = await createMemberAccount(
      { error: null },
      formData({ organizationId: "org-1", email: "new@example.com", role: "viewer" }),
    );

    expect(result.error).toMatch(/Too many accounts/);
    expect(checkRateLimitMock).toHaveBeenCalledWith("member-create:user", "caller-1", 20, 3600);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("doesn't echo the auth provider's reason (e.g. 'already registered') back", async () => {
    mockCallerRole("owner");
    const createUser = vi.fn(async () => ({
      data: { user: null },
      error: { message: "A user with this email address has already been registered" },
    }));
    const { client: admin } = createSupabaseMock({ tables: { signup_exemptions: {} }, authAdmin: { createUser } });
    adminClientMock.mockReturnValue(admin);

    const result = await createMemberAccount(
      { error: null },
      formData({ organizationId: "org-1", email: "taken@example.com", role: "viewer" }),
    );

    expect(result.error).toBe("Couldn't create an account for that email");
  });

  it("rejects a viewer", async () => {
    mockCallerRole("viewer");

    const result = await createMemberAccount(
      { error: null },
      formData({ organizationId: "org-1", email: "new@example.com", role: "viewer" }),
    );

    expect(result.error).toBe("Only an owner can create member accounts");
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("rejects an accountant", async () => {
    mockCallerRole("accountant");

    const result = await createMemberAccount(
      { error: null },
      formData({ organizationId: "org-1", email: "new@example.com", role: "viewer" }),
    );

    expect(result.error).toBe("Only an owner can create member accounts");
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("rejects a caller who isn't a member of the org at all", async () => {
    mockCallerRole(null);

    const result = await createMemberAccount(
      { error: null },
      formData({ organizationId: "org-1", email: "new@example.com", role: "viewer" }),
    );

    expect(result.error).toBe("Only an owner can create member accounts");
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("lets an owner create a member account and returns the generated password once", async () => {
    mockCallerRole("owner");

    const createUser = vi.fn(async () => ({
      data: { user: { id: "new-user-1" } },
      error: null,
    }));
    const { client: admin } = createSupabaseMock({
      tables: {
        signup_exemptions: {},
        organization_members: { insert: ok(null) },
        pending_member_accounts: { insert: ok(null) },
      },
      authAdmin: { createUser },
    });
    adminClientMock.mockReturnValue(admin);

    const result = await createMemberAccount(
      { error: null },
      formData({ organizationId: "org-1", email: "new@example.com", role: "viewer" }),
    );

    expect(result.error).toBeNull();
    expect(result.credentials?.email).toBe("new@example.com");
    expect(result.credentials?.password).toBeTruthy();
    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: "new@example.com", password: result.credentials?.password }),
    );
  });
  it("adds someone who already has a login, without making a new account", async () => {
    mockCallerRole("owner");
    const createUser = vi.fn();
    const { client: admin, tables } = createSupabaseMock({
      tables: { organization_members: { insert: ok(null) } },
      rpcs: { find_user_id_by_email: ok("existing-user-1") },
      authAdmin: { createUser },
    });
    adminClientMock.mockReturnValue(admin);

    const result = await createMemberAccount(
      { error: null },
      formData({ organizationId: "org-1", email: "Member@Example.com", role: "accountant" }),
    );

    expect(result).toEqual({ error: null, added: "member@example.com" });
    expect(admin.rpc).toHaveBeenCalledWith("find_user_id_by_email", { p_email: "member@example.com" });
    expect(tables.organization_members.insert).toHaveBeenCalledWith({
      organization_id: "org-1",
      user_id: "existing-user-1",
      role: "accountant",
    });
    expect(createUser).not.toHaveBeenCalled();
  });

  it("says so when that login is already a member", async () => {
    mockCallerRole("owner");
    const { client: admin } = createSupabaseMock({
      tables: { organization_members: { insert: fail("duplicate key", "23505") } },
      rpcs: { find_user_id_by_email: ok("existing-user-1") },
    });
    adminClientMock.mockReturnValue(admin);

    const result = await createMemberAccount(
      { error: null },
      formData({ organizationId: "org-1", email: "member@example.com", role: "viewer" }),
    );

    expect(result.error).toBe("member@example.com is already a member");
  });
});

describe("regenerateMemberPassword owner gate", () => {
  beforeEach(() => {
    serverClientMock.mockReset();
    adminClientMock.mockReset();
  });

  it("rejects a non-owner", async () => {
    mockCallerRole("accountant");

    const result = await regenerateMemberPassword(
      { error: null },
      formData({ organizationId: "org-1", userId: "member-1", email: "member@example.com" }),
    );

    expect(result.error).toBe("Only an owner can regenerate a member's password");
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  function mockAdmin(opts: { pending: boolean; lastSignIn?: string | null; exists?: boolean }) {
    const updateUserById = vi.fn(async () => ({ data: null, error: null }));
    const getUserById = vi.fn(async () => ({
      data: {
        user:
          opts.exists === false
            ? null
            : { id: "member-1", email: "member@example.com", last_sign_in_at: opts.lastSignIn ?? null },
      },
      error: null,
    }));
    const { client: admin } = createSupabaseMock({
      tables: { pending_member_accounts: { select: ok(opts.pending ? { id: "p-1" } : null) } },
      authAdmin: { updateUserById, getUserById },
    });
    adminClientMock.mockReturnValue(admin);
    return { updateUserById };
  }

  it("lets an owner regenerate a pending member's password", async () => {
    mockCallerRole("owner");
    const { updateUserById } = mockAdmin({ pending: true });

    const result = await regenerateMemberPassword(
      { error: null },
      formData({ organizationId: "org-1", userId: "member-1", email: "member@example.com" }),
    );

    expect(result.error).toBeNull();
    expect(result.credentials).toEqual({
      email: "member@example.com",
      password: expect.any(String),
    });
    expect(updateUserById).toHaveBeenCalledWith("member-1", { password: expect.any(String) });
  });

  it("refuses to reset a user who isn't a pending account of this org", async () => {
    mockCallerRole("owner");
    const { updateUserById } = mockAdmin({ pending: false });

    const result = await regenerateMemberPassword(
      { error: null },
      formData({ organizationId: "org-1", userId: "victim-1", email: "x@example.com" }),
    );

    expect(result.error).toMatch(/unclaimed account/);
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it("refuses to reset a pending account that has already signed in", async () => {
    mockCallerRole("owner");
    const { updateUserById } = mockAdmin({ pending: true, lastSignIn: "2026-09-01T00:00:00Z" });

    const result = await regenerateMemberPassword(
      { error: null },
      formData({ organizationId: "org-1", userId: "member-1", email: "member@example.com" }),
    );

    expect(result.error).toMatch(/unclaimed account/);
    expect(updateUserById).not.toHaveBeenCalled();
  });
});
