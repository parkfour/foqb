import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = path.resolve(__dirname, "../../scripts/publish-mirror.sh");

describe("scripts/publish-mirror.sh", () => {
  let dir: string;
  let source: string;
  let mirror: string;

  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      env: { ...process.env, GIT_AUTHOR_NAME: "Dev", GIT_AUTHOR_EMAIL: "dev@example.com", GIT_COMMITTER_NAME: "Dev", GIT_COMMITTER_EMAIL: "dev@example.com" },
    }).trim();

  const commit = (files: Record<string, string>, message: string) => {
    for (const [name, content] of Object.entries(files)) writeFileSync(path.join(source, name), content);
    git(source, "add", "-A");
    git(source, "commit", "-q", "-m", message);
  };

  const publish = () => execFileSync("sh", [script, mirror], { cwd: source, encoding: "utf8" });
  const mirrorFiles = () => git(mirror, "ls-tree", "-r", "--name-only", "main").split("\n");
  const mirrorLog = () => git(mirror, "log", "--format=%s", "main").split("\n");

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "mirror-test-"));
    source = path.join(dir, "source");
    mirror = path.join(dir, "mirror.git");
    git(dir, "init", "-q", "-b", "main", source);
    git(dir, "init", "-q", "--bare", "-b", "main", mirror);
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("publishes the current tree as one commit, without the private paths or the history", () => {
    commit({ "app.ts": "v1", "secret_parkfour.md": "private", ".gitdontforward": "*_parkfour.md\n" }, "wip 1");
    commit({ "app.ts": "v2" }, "wip 2");

    publish();

    expect(mirrorLog()).toEqual(["Initial public release"]);
    expect(mirrorFiles()).toEqual([".gitdontforward", "app.ts"]);
    expect(git(mirror, "show", "main:app.ts")).toBe("v2");
  });

  it("then publishes each new commit, skipping ones that only touch private paths", () => {
    commit({ "app.ts": "v1", "secret_parkfour.md": "private", ".gitdontforward": "*_parkfour.md\n" }, "wip");
    publish();

    commit({ "app.ts": "v2" }, "feat: two");
    commit({ "secret_parkfour.md": "still private" }, "docs: private only");
    commit({ "app.ts": "v3", "notes_parkfour.md": "also private" }, "feat: three");
    publish();

    expect(mirrorLog()).toEqual(["feat: three", "feat: two", "Initial public release"]);
    expect(mirrorFiles()).toEqual([".gitdontforward", "app.ts"]);
    expect(git(mirror, "log", "-1", "--format=%an <%ae>", "main")).toBe("Dev <dev@example.com>");
  });

  it("publishes version tags on the matching mirror commit, once that commit is published", () => {
    commit({ "app.ts": "v1" }, "wip");
    publish();
    commit({ "app.ts": "v2" }, "feat: two");
    git(source, "tag", "v0.1.0", "HEAD~1");
    git(source, "tag", "v0.2.0");

    // Tags-only: v0.2.0's commit isn't on the mirror yet, so only v0.1.0 goes.
    execFileSync("sh", [script, "--tags-only", mirror], { cwd: source, encoding: "utf8" });
    expect(git(mirror, "tag", "-l")).toBe("v0.1.0");
    expect(git(mirror, "rev-parse", "v0.1.0")).toBe(git(mirror, "rev-parse", "main"));

    publish();
    expect(git(mirror, "tag", "-l").split("\n")).toEqual(["v0.1.0", "v0.2.0"]);
    expect(git(mirror, "show", "v0.2.0:app.ts")).toBe("v2");
    expect(git(mirror, "rev-parse", "v0.2.0")).toBe(git(mirror, "rev-parse", "main"));
  });

  it("does nothing when there's nothing new", () => {
    commit({ "app.ts": "v1" }, "wip");
    publish();

    expect(publish()).toContain("already up to date");
    expect(mirrorLog()).toEqual(["Initial public release"]);
  });
});
