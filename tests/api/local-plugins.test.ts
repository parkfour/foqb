import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

let dir: string;

function generate(folders: Record<string, string[]>): { client: string; server: string } {
  dir = mkdtempSync(join(tmpdir(), "foqb-plugins-"));
  for (const [name, files] of Object.entries(folders)) {
    mkdirSync(join(dir, "local", name), { recursive: true });
    for (const file of files) writeFileSync(join(dir, "local", name, file), "");
  }
  execFileSync("node", ["scripts/local-plugins.mjs", dir]);
  return {
    client: readFileSync(join(dir, "local.generated.ts"), "utf8"),
    server: readFileSync(join(dir, "local-server.generated.ts"), "utf8"),
  };
}

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("scripts/local-plugins.mjs", () => {
  it("writes empty registries when there are no private plugins", () => {
    const { client, server } = generate({});
    expect(client).toContain("export const localPlugins: FOQBPlugin[] = [];");
    expect(server).toContain("export const localServerParts: Record<string, ServerPluginParts> = {};");
  });

  it("registers each plugin folder, its server parts by plugin id, and skips the rest", () => {
    const { client, server } = generate({
      "tax-forms": ["index.ts", "server.ts"],
      notes: ["index.tsx"],
      "Bad Name": ["index.ts"],
      empty: ["readme.md"],
    });
    expect(client).toContain('import { plugin as p0 } from "./local/notes";');
    expect(client).toContain('import { plugin as p1 } from "./local/tax-forms";');
    expect(client).toContain("= [p0, p1];");
    expect(client).not.toMatch(/Bad Name|empty/);
    expect(server).toContain('import { server as s1 } from "./local/tax-forms/server";');
    expect(server).toContain("{ [p1.manifest.id]: s1 }");
    expect(server).not.toContain("./local/notes");
  });
});
