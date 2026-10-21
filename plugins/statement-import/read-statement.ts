// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// Browser-only: a statement PDF's text lines, every page, read on the
// device. Uses the pdf.js worker and Tesseract assets the app serves from
// /ocr (see scripts/copy-ocr-assets.mjs); a scanned page is OCR'd here too.
import type { Worker } from "tesseract.js";
import { ocrLines, pageLines, type OcrLine, type PdfTextItem } from "./text-lines";

const OCR_ASSETS = "/ocr";
// Scans are rendered at 216 dpi for OCR: 3 pixels per PDF point.
const OCR_SCALE = 3;

async function ocrWorker(): Promise<Worker> {
  const { createWorker } = await import("tesseract.js");
  return createWorker("eng", 1, { workerPath: `${OCR_ASSETS}/worker.min.js`, corePath: OCR_ASSETS, langPath: OCR_ASSETS });
}

export async function readStatementLines(file: File, onProgress: (message: string) => void = () => {}): Promise<string[]> {
  if (file.type !== "application/pdf") throw new Error("Choose the statement's PDF.");
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = `${OCR_ASSETS}/pdf.worker.min.mjs`;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), wasmUrl: `${OCR_ASSETS}/pdfjs-wasm/` });
  let worker: Worker | null = null;
  try {
    const doc = await task.promise;
    const lines: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const items = (await page.getTextContent()).items.filter((i) => "str" in i) as PdfTextItem[];
      if (items.some((i) => i.str.trim() !== "")) {
        lines.push(...pageLines(items));
        continue;
      }
      // A scanned page: render it and read the picture.
      onProgress(`Reading scanned page ${p} of ${doc.numPages}…`);
      const viewport = page.getViewport({ scale: OCR_SCALE });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvas, viewport }).promise;
      worker ??= await ocrWorker();
      const { data } = await worker.recognize(canvas, {}, { blocks: true });
      const ocr: OcrLine[] = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((para) => para.lines));
      lines.push(...ocrLines(ocr, OCR_SCALE));
    }
    if (lines.length === 0) throw new Error("No text could be read from this PDF.");
    return lines;
  } finally {
    await worker?.terminate();
    await task.destroy();
  }
}
