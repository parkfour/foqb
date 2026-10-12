import { describe, expect, it, vi } from "vitest";

const { execSyncMock } = vi.hoisted(() => ({ execSyncMock: vi.fn() }));
vi.mock("node:child_process", () => ({ execSync: execSyncMock }));

import { resolveGitSha } from "@/lib/version/git-sha";

describe("resolveGitSha", () => {
  it("prefers CI_GIT_SHA when set", () => {
    expect(
      resolveGitSha({ CI_GIT_SHA: "abc1234", NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA: "f".repeat(40) }),
    ).toBe("abc1234");
    expect(execSyncMock).not.toHaveBeenCalled();
  });

  it("falls back to a truncated NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA when CI_GIT_SHA is absent", () => {
    expect(resolveGitSha({ NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA: "abcdef1234567890" })).toBe(
      "abcdef1",
    );
    expect(execSyncMock).not.toHaveBeenCalled();
  });

  it("falls back to a local git rev-parse when neither env var is set", () => {
    execSyncMock.mockReturnValueOnce(Buffer.from("1234567\n"));
    expect(resolveGitSha({})).toBe("1234567");
  });

  // This is the exact bug that shipped "unknown" to production once already
  // (fixed by adding CI_GIT_SHA) — covering it directly so a regression in
  // this fallback chain doesn't silently ship a blank footer again.
  it('falls back to "unknown" when git rev-parse fails and no env var is set', () => {
    execSyncMock.mockImplementationOnce(() => {
      throw new Error("not a git repo");
    });
    expect(resolveGitSha({})).toBe("unknown");
  });
});
