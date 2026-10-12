import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, fail, ok } from "./supabase-mock";

const { serverClientMock, adminClientMock, redirectMock, checkRateLimitMock } = vi.hoisted(() => ({
  serverClientMock: vi.fn(),
  adminClientMock: vi.fn(),
  redirectMock: vi.fn(),
  checkRateLimitMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: serverClientMock }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: adminClientMock }));
// Real redirect() throws to stop execution; mirror that.
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ origin: "https://foqb.example" }) }));
vi.mock("@/lib/auth/rate-limit", () => ({ checkRateLimit: checkRateLimitMock }));

import { signup } from "@/app/signup/actions";
import { acceptPolicies } from "@/app/accept-terms/actions";
import { POLICY_VERSION, requireCurrentPolicyAcceptance } from "@/lib/legal/policy";

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

beforeEach(() => {
  serverClientMock.mockReset();
  adminClientMock.mockReset();
  checkRateLimitMock.mockReset().mockResolvedValue(true);
  redirectMock.mockReset().mockImplementation((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  });
});

describe("signup consent", () => {
  function mockSignUp(signupsEnabled = true) {
    const { client } = createSupabaseMock({
      tables: { site_settings: { select: ok({ signups_enabled: signupsEnabled }) } },
    });
    const signUp = vi.fn(async () => ({ data: { user: { id: "new-user" } }, error: null }));
    Object.assign(client.auth, { signUp });
    serverClientMock.mockResolvedValue(client);
    const { client: admin, tables } = createSupabaseMock({
      tables: { policy_acceptances: { upsert: ok(null) } },
    });
    adminClientMock.mockReturnValue(admin);
    return { signUp, tables };
  }

  it("refuses to sign up without agreeing to the policies", async () => {
    const { signUp } = mockSignUp();

    await expect(signup(formData({ email: "a@example.com", password: "password123" }))).rejects.toThrow(
      /REDIRECT:\/signup\?error=.*agree/,
    );
    expect(signUp).not.toHaveBeenCalled();
  });

  it("refuses to sign up while sign-ups are closed", async () => {
    const { signUp } = mockSignUp(false);

    await expect(
      signup(formData({ email: "a@example.com", password: "password123", acceptPolicies: "on" })),
    ).rejects.toThrow(/REDIRECT:\/signup\?error=Sign-ups%20are%20closed/);
    expect(signUp).not.toHaveBeenCalled();
  });

  it("records acceptance of the current policy version for the new user", async () => {
    const { signUp, tables } = mockSignUp();

    await expect(
      signup(formData({ email: "a@example.com", password: "password123", acceptPolicies: "on" })),
    ).rejects.toThrow(/REDIRECT:\/signup\?message=/);

    expect(signUp).toHaveBeenCalled();
    expect(tables.policy_acceptances.upsert).toHaveBeenCalledWith(
      { user_id: "new-user", version: POLICY_VERSION },
      { onConflict: "user_id,version", ignoreDuplicates: true },
    );
  });
});

describe("accept-terms", () => {
  function mockUser(upsertResult = ok(null)) {
    const { client, tables } = createSupabaseMock({
      user: { id: "user-1" },
      tables: { policy_acceptances: { upsert: upsertResult } },
    });
    serverClientMock.mockResolvedValue(client);
    return tables;
  }

  it("requires the box to be ticked", async () => {
    const tables = mockUser();

    await expect(acceptPolicies(formData({}))).rejects.toThrow(/REDIRECT:\/accept-terms\?error=/);
    expect(tables.policy_acceptances.upsert).not.toHaveBeenCalled();
  });

  it("records the user's acceptance of the current version and continues into the app", async () => {
    const tables = mockUser();

    await expect(acceptPolicies(formData({ accept: "on" }))).rejects.toThrow("REDIRECT:/");
    expect(tables.policy_acceptances.upsert).toHaveBeenCalledWith(
      { user_id: "user-1", version: POLICY_VERSION },
      { onConflict: "user_id,version", ignoreDuplicates: true },
    );
  });

  it("stays on the page with an error if recording fails", async () => {
    mockUser(fail("db down"));

    await expect(acceptPolicies(formData({ accept: "on" }))).rejects.toThrow(/REDIRECT:\/accept-terms\?error=/);
  });
});

describe("requireCurrentPolicyAcceptance", () => {
  function mockAcceptance(accepted: boolean) {
    const { client, tables } = createSupabaseMock({
      user: { id: "user-1" },
      tables: { policy_acceptances: { select: ok(accepted ? { version: POLICY_VERSION } : null) } },
    });
    serverClientMock.mockResolvedValue(client);
    return tables;
  }

  it("lets a user who accepted the current version through", async () => {
    const tables = mockAcceptance(true);

    await expect(requireCurrentPolicyAcceptance()).resolves.toBeUndefined();
    expect(tables.policy_acceptances.eq).toHaveBeenCalledWith("version", POLICY_VERSION);
  });

  it("sends anyone else to /accept-terms", async () => {
    mockAcceptance(false);

    await expect(requireCurrentPolicyAcceptance()).rejects.toThrow("REDIRECT:/accept-terms");
  });
});
