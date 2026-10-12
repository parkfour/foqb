import { describe, expect, it, vi } from "vitest";
import { createSupabaseMock, fail, ok } from "./supabase-mock";
import { adminCreateUser } from "@/lib/auth/admin-create-user";

describe("adminCreateUser", () => {
  it("exempts the email from the sign-up lock, creates the user, then clears the exemption", async () => {
    const createUser = vi.fn(async () => ({ data: { user: { id: "u1" } }, error: null }));
    const { client, tables } = createSupabaseMock({
      tables: { signup_exemptions: { upsert: ok(null), delete: ok(null) } },
      authAdmin: { createUser },
    });

    const result = await adminCreateUser(client as never, { email: "New@Example.com", password: "pw" });

    expect(result.data.user?.id).toBe("u1");
    expect(tables.signup_exemptions.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ email: "new@example.com" }),
    );
    expect(createUser).toHaveBeenCalledWith({ email: "New@Example.com", password: "pw" });
    expect(tables.signup_exemptions.delete).toHaveBeenCalled();
    expect(tables.signup_exemptions.eq).toHaveBeenCalledWith("email", "new@example.com");
  });

  it("doesn't create the user if the exemption can't be recorded", async () => {
    const createUser = vi.fn();
    const { client } = createSupabaseMock({
      tables: { signup_exemptions: { upsert: fail("boom") } },
      authAdmin: { createUser },
    });

    const result = await adminCreateUser(client as never, { email: "a@example.com" });

    expect(result.error?.message).toBe("boom");
    expect(createUser).not.toHaveBeenCalled();
  });
});
