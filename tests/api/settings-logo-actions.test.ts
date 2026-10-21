import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, ok } from "./supabase-mock";
import { MAX_LOGO_BYTES } from "@/lib/org/logo";

const { serverClientMock, redirectMock, revalidatePathMock, getCurrentUserRoleMock } = vi.hoisted(() => ({
  serverClientMock: vi.fn(),
  redirectMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  getCurrentUserRoleMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: serverClientMock }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/org/current", () => ({ getCurrentUserRole: getCurrentUserRoleMock }));

import { removeOrganizationLogo, setBankLinking, uploadOrganizationLogo } from "@/app/(dashboard)/settings/actions";

function formDataWithFile(fields: Record<string, string>, file?: File): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  if (file) fd.set("file", file);
  return fd;
}

beforeEach(() => {
  serverClientMock.mockReset();
  revalidatePathMock.mockReset();
  getCurrentUserRoleMock.mockReset();
  redirectMock.mockReset().mockImplementation((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  });
});

describe("uploadOrganizationLogo", () => {
  it("rejects a non-owner", async () => {
    getCurrentUserRoleMock.mockResolvedValue("accountant");
    const file = new File(["fake-image-bytes"], "logo.png", { type: "image/png" });

    await expect(
      uploadOrganizationLogo(formDataWithFile({ organizationId: "org-1" }, file)),
    ).rejects.toThrow("REDIRECT:");
    expect(redirectMock).toHaveBeenCalledWith(expect.stringContaining(encodeURIComponent("Only an owner")));
    expect(serverClientMock).not.toHaveBeenCalled();
  });

  it("rejects a non-image file", async () => {
    getCurrentUserRoleMock.mockResolvedValue("owner");
    const file = new File(["not an image"], "notes.txt", { type: "text/plain" });

    await expect(
      uploadOrganizationLogo(formDataWithFile({ organizationId: "org-1" }, file)),
    ).rejects.toThrow("REDIRECT:");
    expect(redirectMock).toHaveBeenCalledWith(expect.stringContaining(encodeURIComponent("must be an image")));
  });

  it("rejects a file over the size cap", async () => {
    getCurrentUserRoleMock.mockResolvedValue("owner");
    const oversized = new File([new Uint8Array(MAX_LOGO_BYTES + 1)], "big.png", { type: "image/png" });

    await expect(
      uploadOrganizationLogo(formDataWithFile({ organizationId: "org-1" }, oversized)),
    ).rejects.toThrow("REDIRECT:");
    expect(redirectMock).toHaveBeenCalledWith(expect.stringContaining(encodeURIComponent("must be under")));
  });

  it("stores a valid image as a base64 data URI and revalidates", async () => {
    getCurrentUserRoleMock.mockResolvedValue("owner");
    const { client, tables } = createSupabaseMock({
      tables: { organizations: { update: ok(null) } },
    });
    serverClientMock.mockResolvedValue(client);
    const file = new File([new Uint8Array([1, 2, 3])], "logo.png", { type: "image/png" });

    await uploadOrganizationLogo(formDataWithFile({ organizationId: "org-1" }, file));

    expect(tables.organizations.update).toHaveBeenCalledWith(
      expect.objectContaining({ logo_data_url: expect.stringMatching(/^data:image\/png;base64,/) }),
    );
    expect(revalidatePathMock).toHaveBeenCalledWith("/settings");
    expect(revalidatePathMock).toHaveBeenCalledWith("/", "layout");
    expect(redirectMock).not.toHaveBeenCalled();
  });
});

describe("removeOrganizationLogo", () => {
  it("rejects a non-owner", async () => {
    getCurrentUserRoleMock.mockResolvedValue("viewer");

    await expect(
      removeOrganizationLogo(formDataWithFile({ organizationId: "org-1" })),
    ).rejects.toThrow("REDIRECT:");
    expect(serverClientMock).not.toHaveBeenCalled();
  });

  it("clears the logo for an owner", async () => {
    getCurrentUserRoleMock.mockResolvedValue("owner");
    const { client, tables } = createSupabaseMock({
      tables: { organizations: { update: ok(null) } },
    });
    serverClientMock.mockResolvedValue(client);

    await removeOrganizationLogo(formDataWithFile({ organizationId: "org-1" }));

    expect(tables.organizations.update).toHaveBeenCalledWith({ logo_data_url: null });
    expect(revalidatePathMock).toHaveBeenCalledWith("/", "layout");
  });
});

describe("setBankLinking", () => {
  it("rejects a non-owner", async () => {
    getCurrentUserRoleMock.mockResolvedValue("accountant");

    await expect(setBankLinking(formDataWithFile({ organizationId: "org-1" }))).rejects.toThrow("REDIRECT:");
    expect(redirectMock).toHaveBeenCalledWith(expect.stringContaining(encodeURIComponent("Only an owner")));
    expect(serverClientMock).not.toHaveBeenCalled();
  });

  it("lets an owner turn connecting banks off (unchecked box) and back on", async () => {
    getCurrentUserRoleMock.mockResolvedValue("owner");
    const { client, tables } = createSupabaseMock({ tables: { organizations: { update: ok(null) } } });
    serverClientMock.mockResolvedValue(client);

    await setBankLinking(formDataWithFile({ organizationId: "org-1" }));
    expect(tables.organizations.update).toHaveBeenLastCalledWith({ bank_linking_enabled: false });

    await setBankLinking(formDataWithFile({ organizationId: "org-1", bankLinkingEnabled: "on" }));
    expect(tables.organizations.update).toHaveBeenLastCalledWith({ bank_linking_enabled: true });
    expect(tables.organizations.eq).toHaveBeenCalledWith("id", "org-1");
  });
});
