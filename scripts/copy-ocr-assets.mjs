// Copies what the receipt-ocr plugin runs in the browser (Tesseract's
// worker, its WebAssembly core, the English model, and pdf.js's worker)
// from node_modules into public/ocr, so the app serves them itself and a
// receipt never involves a third-party CDN. Runs before every build and dev
// server; public/ocr is not committed.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "ocr");
const files = {
  "tesseract.js/dist/worker.min.js": "worker.min.js",
  // tesseract.js picks one of these by what the browser supports.
  "tesseract.js-core/tesseract-core-lstm.wasm.js": "tesseract-core-lstm.wasm.js",
  "tesseract.js-core/tesseract-core-simd-lstm.wasm.js": "tesseract-core-simd-lstm.wasm.js",
  "tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js": "tesseract-core-relaxedsimd-lstm.wasm.js",
  "@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz": "eng.traineddata.gz",
  "pdfjs-dist/build/pdf.worker.min.mjs": "pdf.worker.min.mjs",
  // pdf.js decodes some scanned images with WebAssembly it fetches from
  // wasmUrl: JBIG2 (black-and-white scans), JPEG 2000, and colour profiles.
  // Without them a scan's text layer silently doesn't draw.
  "pdfjs-dist/wasm/jbig2.wasm": "pdfjs-wasm/jbig2.wasm",
  "pdfjs-dist/wasm/openjpeg.wasm": "pdfjs-wasm/openjpeg.wasm",
  "pdfjs-dist/wasm/qcms_bg.wasm": "pdfjs-wasm/qcms_bg.wasm",
  "pdfjs-dist/wasm/LICENSE_JBIG2": "pdfjs-wasm/LICENSE_JBIG2",
  "pdfjs-dist/wasm/LICENSE_OPENJPEG": "pdfjs-wasm/LICENSE_OPENJPEG",
  "pdfjs-dist/wasm/LICENSE_QCMS": "pdfjs-wasm/LICENSE_QCMS",
};

mkdirSync(join(out, "pdfjs-wasm"), { recursive: true });
for (const [from, to] of Object.entries(files)) {
  copyFileSync(join(root, "node_modules", from), join(out, to));
}
