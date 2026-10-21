// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// pdf.js hands back a page's text as positioned fragments. Statements are
// tables, so this rebuilds the visual lines: fragments on the same baseline
// joined left to right, with a wide gap (a new column) kept as " | ".
export interface PdfTextItem {
  str: string;
  transform: number[]; // [a, b, c, d, x, y]
  width: number;
}

// Fragments whose baselines are this close (in PDF points) share a line.
const SAME_LINE = 2;
// A gap wider than this between fragments is a column break.
const COLUMN_GAP = 12;

export function pageLines(items: PdfTextItem[]): string[] {
  const placed = items
    .filter((i) => i.str.trim() !== "")
    .map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5], end: i.transform[4] + i.width }))
    .sort((a, b) => b.y - a.y || a.x - b.x);

  const rows: (typeof placed)[] = [];
  for (const item of placed) {
    const row = rows.at(-1);
    if (row && Math.abs(row[0].y - item.y) <= SAME_LINE) row.push(item);
    else rows.push([item]);
  }

  return rows.map((row) => {
    row.sort((a, b) => a.x - b.x);
    let line = "";
    let lastEnd: number | null = null;
    for (const item of row) {
      if (lastEnd !== null) line += item.x - lastEnd > COLUMN_GAP ? " | " : item.x - lastEnd > 1 ? " " : "";
      line += item.str.trim();
      lastEnd = item.end;
    }
    return line;
  });
}

export interface OcrLine {
  baseline: { y0: number };
  words: { text: string; bbox: { x0: number; x1: number } }[];
}

// A scanned page's lines as OCR found them (in pixels, at pixelsPerPoint),
// top to bottom, with the same " | " column breaks as pageLines.
export function ocrLines(lines: OcrLine[], pixelsPerPoint: number): string[] {
  return [...lines]
    .sort((a, b) => a.baseline.y0 - b.baseline.y0)
    .map((line) =>
      line.words
        .filter((w) => w.text.trim() !== "")
        .map((w, i, words) => (i === 0 ? "" : w.bbox.x0 - words[i - 1].bbox.x1 > COLUMN_GAP * pixelsPerPoint ? " | " : " ") + w.text.trim())
        .join(""),
    )
    .filter((line) => line !== "");
}
