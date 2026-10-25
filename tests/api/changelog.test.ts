// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseChangelog, parseInline } from "@/lib/changelog";
import packageJson from "@/package.json";

describe("parseChangelog", () => {
  it("reads headings, paragraphs and lists, with wrapped list items joined", () => {
    expect(parseChangelog("# Log\n\nIntro\nmore.\n\n## 1.0\n\n- **One** thing\n  wrapped\n- Two")).toEqual([
      { kind: "h1", inline: [{ kind: "text", text: "Log" }] },
      { kind: "p", inline: [{ kind: "text", text: "Intro more." }] },
      { kind: "h2", inline: [{ kind: "text", text: "1.0" }] },
      {
        kind: "ul",
        items: [
          [{ kind: "bold", text: "One" }, { kind: "text", text: " thing wrapped" }],
          [{ kind: "text", text: "Two" }],
        ],
      },
    ]);
  });

  it("reads italics, code and links inline", () => {
    expect(parseInline("*Off* or `x` at [docs](https://e.com).")).toEqual([
      { kind: "italic", text: "Off" },
      { kind: "text", text: " or " },
      { kind: "code", text: "x" },
      { kind: "text", text: " at " },
      { kind: "link", text: "docs", href: "https://e.com" },
      { kind: "text", text: "." },
    ]);
  });

  it("has an entry for the version in package.json", () => {
    const headings = parseChangelog(readFileSync("CHANGELOG.md", "utf8")).filter((b) => b.kind === "h2");
    expect(headings.some((h) => h.kind === "h2" && h.inline[0]?.kind === "text" && h.inline[0].text.startsWith(`${packageJson.version} `))).toBe(true);
  });
});
