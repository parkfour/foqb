import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, fail, ok } from "./supabase-mock";

const { serverClientMock, redirectMock, revalidatePathMock } = vi.hoisted(() => ({
  serverClientMock: vi.fn(),
  redirectMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: serverClientMock }));
// Next's real redirect() throws (a special digest-tagged error caught by the
// framework) and callers rely on that to stop execution — mirror that here
// rather than letting a no-op mock silently fall through to later code.
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import { removeMember, setOwnerRemovalSecret, updateMemberRole } from "@/app/(dashboard)/settings/actions";

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

beforeEach(() => {
  serverClientMock.mockReset();
  revalidatePathMock.mockReset();
  redirectMock.mockReset().mockImplementation((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  });
});

describe("removeMember", () => {
  it("calls the guarded RPC with the submitted secret and revalidates on success", async () => {
    const { client } = createSupabaseMock({ tables: {}, rpc: ok(null) });
    serverClientMock.mockResolvedValue(client);

    await removeMember(formData({ id: "member-1", secret: "correct-horse" }));

    expect(client.rpc).toHaveBeenCalledWith("remove_org_member_guarded", {
      p_member_id: "member-1",
      p_secret: "correct-horse",
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/settings");
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("redirects with the error message when the guard rejects it", async () => {
    const { client } = createSupabaseMock({
      tables: {},
      rpc: fail("This organization has no owner-removal secret set"),
    });
    serverClientMock.mockResolvedValue(client);

    await expect(removeMember(formData({ id: "member-1" }))).rejects.toThrow("REDIRECT:");
    expect(redirectMock).toHaveBeenCalledWith(
      "/settings?error=This%20organization%20has%20no%20owner-removal%20secret%20set",
    );
  });
});

describe("updateMemberRole", () => {
  it("calls the guarded RPC with role and secret", async () => {
    const { client } = createSupabaseMock({ tables: {}, rpc: ok(null) });
    serverClientMock.mockResolvedValue(client);

    await updateMemberRole(formData({ id: "member-1", role: "accountant", secret: "correct-horse" }));

    expect(client.rpc).toHaveBeenCalledWith("update_org_member_role_guarded", {
      p_member_id: "member-1",
      p_role: "accountant",
      p_secret: "correct-horse",
    });
  });

  it("redirects with the error message when the guard rejects it", async () => {
    const { client } = createSupabaseMock({
      tables: {},
      rpc: fail("Incorrect owner-removal secret"),
    });
    serverClientMock.mockResolvedValue(client);

    await expect(
      updateMemberRole(formData({ id: "member-1", role: "accountant" })),
    ).rejects.toThrow("REDIRECT:");
    expect(redirectMock).toHaveBeenCalledWith("/settings?error=Incorrect%20owner-removal%20secret");
  });
});

describe("setOwnerRemovalSecret", () => {
  it("redirects when the secret is under 8 characters", async () => {
    await expect(
      setOwnerRemovalSecret(
        formData({ organizationId: "org-1", secret: "short", secretConfirm: "short" }),
      ),
    ).rejects.toThrow("REDIRECT:");

    expect(redirectMock).toHaveBeenCalledWith(
      expect.stringContaining(encodeURIComponent("at least 8 characters")),
    );
    expect(serverClientMock).not.toHaveBeenCalled();
  });

  it("redirects when the confirmation doesn't match", async () => {
    await expect(
      setOwnerRemovalSecret(
        formData({ organizationId: "org-1", secret: "correct-horse", secretConfirm: "different" }),
      ),
    ).rejects.toThrow("REDIRECT:");

    expect(redirectMock).toHaveBeenCalledWith(
      expect.stringContaining(encodeURIComponent("confirmation don't match")),
    );
    expect(serverClientMock).not.toHaveBeenCalled();
  });

  it("sets the secret when valid and matching", async () => {
    const { client } = createSupabaseMock({ tables: {}, rpc: ok(null) });
    serverClientMock.mockResolvedValue(client);

    await setOwnerRemovalSecret(
      formData({ organizationId: "org-1", secret: "correct-horse", secretConfirm: "correct-horse" }),
    );

    expect(client.rpc).toHaveBeenCalledWith("set_owner_removal_secret", {
      p_org_id: "org-1",
      p_secret: "correct-horse",
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/settings");
  });
});
