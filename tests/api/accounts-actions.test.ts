import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, fail, ok } from "./supabase-mock";

const { serverClientMock } = vi.hoisted(() => ({ serverClientMock: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: serverClientMock,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { deleteAccount, toggleAccountActive } from "@/app/(dashboard)/accounts/actions";

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

describe("deleteAccount", () => {
  beforeEach(() => {
    serverClientMock.mockReset();
  });

  it("deletes an account with no references", async () => {
    const { client } = createSupabaseMock({
      tables: { accounts: { delete: ok(null) } },
    });
    serverClientMock.mockResolvedValue(client);

    const result = await deleteAccount({ error: null }, formData({ id: "acc-1" }));

    expect(result).toEqual({ error: null });
  });

  it("returns a friendly error instead of the raw FK violation", async () => {
    const { client } = createSupabaseMock({
      tables: {
        accounts: { delete: fail("update or delete on table \"accounts\" violates foreign key constraint", "23503") },
      },
    });
    serverClientMock.mockResolvedValue(client);

    const result = await deleteAccount({ error: null }, formData({ id: "acc-1" }));

    expect(result.error).toMatch(/can't be deleted — deactivate it instead/);
  });

  it("surfaces any other database error message directly", async () => {
    const { client } = createSupabaseMock({
      tables: { accounts: { delete: fail("connection lost") } },
    });
    serverClientMock.mockResolvedValue(client);

    const result = await deleteAccount({ error: null }, formData({ id: "acc-1" }));

    expect(result.error).toBe("connection lost");
  });
});

describe("toggleAccountActive", () => {
  it("flips is_active to false for an active account", async () => {
    const { client, tables } = createSupabaseMock({
      tables: { accounts: { update: ok(null) } },
    });
    serverClientMock.mockResolvedValue(client);

    await toggleAccountActive(formData({ id: "acc-1", isActive: "true" }));

    expect(tables.accounts.update).toHaveBeenCalledWith({ is_active: false });
  });

  it("flips is_active to true for an inactive account", async () => {
    const { client, tables } = createSupabaseMock({
      tables: { accounts: { update: ok(null) } },
    });
    serverClientMock.mockResolvedValue(client);

    await toggleAccountActive(formData({ id: "acc-1", isActive: "false" }));

    expect(tables.accounts.update).toHaveBeenCalledWith({ is_active: true });
  });
});
