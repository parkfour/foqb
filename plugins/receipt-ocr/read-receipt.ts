// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// Browser-only: turns a photo or PDF of a receipt into text, on the device.
// Nothing is uploaded; the OCR engine and its English model are served by
// this app from /ocr (see scripts/copy-ocr-assets.mjs).

export interface ReceiptText {
  text: string;
  // Tesseract's 0-100 estimate; null for text taken straight from a PDF.
  confidence: number | null;
  source: "pdf" | "ocr";
}

const OCR_ASSETS = "/ocr";
// A PDF with less text than this is a scan, and gets OCR instead.
const MIN_PDF_TEXT = 20;

async function ocr(image: File | HTMLCanvasElement, onProgress: (message: string) => void): Promise<ReceiptText> {
  const { createWorker } = await import("tesseract.js");
  onProgress("Loading the text reader…");
  const worker = await createWorker("eng", 1, {
    workerPath: `${OCR_ASSETS}/worker.min.js`,
    corePath: OCR_ASSETS,
    langPath: OCR_ASSETS,
    logger: (m: { status: string; progress: number }) => {
      if (m.status === "recognizing text") onProgress(`Reading… ${Math.round(m.progress * 100)}%`);
    },
  });
  try {
    const { data } = await worker.recognize(image);
    return { text: data.text, confidence: Math.round(data.confidence), source: "ocr" };
  } finally {
    await worker.terminate();
  }
}

async function readPdf(file: File, onProgress: (message: string) => void): Promise<ReceiptText> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs"); // older Safari too
  pdfjs.GlobalWorkerOptions.workerSrc = `${OCR_ASSETS}/pdf.worker.min.mjs`;
  // wasmUrl: the decoders for scanned images (see scripts/copy-ocr-assets.mjs).
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), wasmUrl: `${OCR_ASSETS}/pdfjs-wasm/` });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : " ") : ""))
      .join("")
      .replace(/[ \t]+\n/g, "\n");
    if (text.replace(/\s/g, "").length >= MIN_PDF_TEXT) return { text, confidence: null, source: "pdf" };

    // A scanned PDF: render the first page and read the picture.
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvas, viewport }).promise;
    return ocr(canvas, onProgress);
  } finally {
    await task.destroy();
  }
}

export function readReceipt(file: File, onProgress: (message: string) => void): Promise<ReceiptText> {
  if (file.type === "application/pdf") return readPdf(file, onProgress);
  if (file.type.startsWith("image/")) return ocr(file, onProgress);
  return Promise.reject(new Error("Choose a photo or a PDF of the receipt."));
}
