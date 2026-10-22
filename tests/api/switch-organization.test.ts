import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, ok } from "./supabase-mock";

const { serverClientMock, redirectMock, cookieSet } = vi.hoisted(() => ({
  serverClientMock: vi.fn(),
  redirectMock: vi.fn(),
  cookieSet: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: serverClientMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: cookieSet }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { switchOrganization } from "@/app/(dashboard)/actions";

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

describe("switchOrganization", () => {
  beforeEach(() => {
    redirectMock.mockReset();
    cookieSet.mockReset();
    const { client } = createSupabaseMock({
      user: { id: "user-1" },
      tables: { organization_members: { select: ok({ id: "m-1" }) } },
    });
    serverClientMock.mockResolvedValue(client);
  });

  it("lands on the book's dashboard", async () => {
    await switchOrganization(form({ organizationId: "org-2" }));

    expect(cookieSet).toHaveBeenCalledWith("current_org_id", "org-2", expect.anything());
    expect(redirectMock).toHaveBeenCalledWith("/");
  });

  it("lands on a page in the book when the form names one on this site", async () => {
    await switchOrganization(form({ organizationId: "org-2", next: "/reports/tax-line/accounts?taxLineId=t&type=revenue" }));
    expect(redirectMock).toHaveBeenCalledWith("/reports/tax-line/accounts?taxLineId=t&type=revenue");

    await switchOrganization(form({ organizationId: "org-2", next: "//evil.example" }));
    expect(redirectMock).toHaveBeenLastCalledWith("/");
  });
});
