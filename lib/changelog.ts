// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// CHANGELOG.md as blocks for app/changelog. Only what the changelog uses:
// "#", "##" and "###" headings, paragraphs, "- " lists (wrapped lines
// continue an item), and **bold**, *italic*, `code` and [links](url) inline.

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "bold" | "italic" | "code"; text: string }
  | { kind: "link"; text: string; href: string };

export type Block =
  | { kind: "h1" | "h2" | "h3" | "p"; inline: Inline[] }
  | { kind: "ul"; items: Inline[][] };

const INLINE = /\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|\[(.+?)\]\((.+?)\)/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let at = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > at) out.push({ kind: "text", text: text.slice(at, m.index) });
    if (m[1] !== undefined) out.push({ kind: "bold", text: m[1] });
    else if (m[2] !== undefined) out.push({ kind: "italic", text: m[2] });
    else if (m[3] !== undefined) out.push({ kind: "code", text: m[3] });
    else out.push({ kind: "link", text: m[4], href: m[5] });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ kind: "text", text: text.slice(at) });
  return out;
}

export function parseChangelog(markdown: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let items: string[] | null = null;
  const flush = () => {
    if (para.length) blocks.push({ kind: "p", inline: parseInline(para.join(" ")) });
    if (items) blocks.push({ kind: "ul", items: items.map(parseInline) });
    para = [];
    items = null;
  };
  for (const raw of markdown.split("\n")) {
    const line = raw.trim();
    const heading = /^(#{1,3}) (.*)$/.exec(line);
    if (!line) flush();
    else if (heading) {
      flush();
      blocks.push({ kind: (["h1", "h2", "h3"] as const)[heading[1].length - 1], inline: parseInline(heading[2]) });
    } else if (line.startsWith("- ")) {
      if (para.length) flush();
      (items ??= []).push(line.slice(2));
    } else if (items) items[items.length - 1] += ` ${line}`;
    else para.push(line);
  }
  flush();
  return blocks;
}
