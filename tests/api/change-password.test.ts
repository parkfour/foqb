import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateUser, signInWithPassword, signOut } = vi.hoisted(() => ({
  updateUser: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1", email: "member@example.com" } } }), updateUser },
  }),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { signInWithPassword, signOut } }),
}));
vi.mock("@/lib/auth/rate-limit", () => ({ checkRateLimit: async () => true }));

import { changePassword } from "@/app/(dashboard)/settings/password-actions";

function form(current: string, password: string, confirm = password) {
  const data = new FormData();
  data.set("currentPassword", current);
  data.set("password", password);
  data.set("confirmPassword", confirm);
  return data;
}
const start = { error: null, done: false };

describe("changePassword", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateUser.mockResolvedValue({ error: null });
    signOut.mockResolvedValue({ error: null });
  });

  it("changes it once the current password checks out", async () => {
    signInWithPassword.mockResolvedValue({ error: null });
    expect(await changePassword(start, form("old-password", "new-password"))).toEqual({ error: null, done: true });
    expect(signInWithPassword).toHaveBeenCalledWith({ email: "member@example.com", password: "old-password" });
    expect(updateUser).toHaveBeenCalledWith({ password: "new-password" });
  });

  it("refuses a wrong current password, or new ones that don't match", async () => {
    signInWithPassword.mockResolvedValue({ error: { message: "Invalid login credentials" } });
    expect((await changePassword(start, form("guess", "new-password"))).error).toBe("The current password isn't right");
    expect((await changePassword(start, form("old-password", "new-password", "other-one"))).error).toBe(
      "The new passwords don't match",
    );
    expect(updateUser).not.toHaveBeenCalled();
  });
});
