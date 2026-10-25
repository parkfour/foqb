// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from "node:fs";
import { join } from "node:path";
import Link from "next/link";
import { parseChangelog, type Inline } from "@/lib/changelog";

// The changelog of the code this instance runs (next.config.ts ships the
// file with the server).

function Text({ inline }: { inline: Inline[] }) {
  return inline.map((part, i) => {
    if (part.kind === "bold") return <strong key={i} className="font-semibold text-slate-900">{part.text}</strong>;
    if (part.kind === "italic") return <em key={i}>{part.text}</em>;
    if (part.kind === "code") return <code key={i} className="rounded bg-slate-100 px-1 text-[0.85em]">{part.text}</code>;
    if (part.kind === "link") {
      // A repository path (docs/…) has no page here; show it as text.
      return /^https?:\/\//.test(part.href) ? (
        <a key={i} href={part.href} className="text-slate-900 underline">
          {part.text}
        </a>
      ) : (
        <span key={i}>{part.text}</span>
      );
    }
    return part.text;
  });
}

export default function ChangelogPage() {
  const blocks = parseChangelog(readFileSync(join(process.cwd(), "CHANGELOG.md"), "utf8"));

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 text-sm text-slate-700">
      <Link href="/" className="text-slate-500 hover:text-slate-900">
        ← Back
      </Link>
      <div className="mt-4 flex flex-col gap-3">
        {blocks.map((b, i) => {
          if (b.kind === "h1") return <h1 key={i} className="text-2xl font-semibold text-slate-900"><Text inline={b.inline} /></h1>;
          if (b.kind === "h2") return <h2 key={i} className="mt-6 border-b border-slate-200 pb-1 text-lg font-semibold text-slate-900"><Text inline={b.inline} /></h2>;
          if (b.kind === "h3") return <h3 key={i} className="mt-2 text-sm font-semibold text-slate-900"><Text inline={b.inline} /></h3>;
          if (b.kind !== "ul") return <p key={i}><Text inline={b.inline} /></p>;
          return (
            <ul key={i} className="ml-5 flex list-disc flex-col gap-1.5">
              {b.items.map((item, j) => (
                <li key={j}><Text inline={item} /></li>
              ))}
            </ul>
          );
        })}
      </div>
    </div>
  );
}
