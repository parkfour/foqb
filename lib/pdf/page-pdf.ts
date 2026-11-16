// The browser's PDF of a document on screen (an invoice, a statement):
// html2canvas renders the styled markup to a canvas, and jsPDF embeds it on
// letter pages, continuing onto more pages when it's longer than one. This
// reuses the exact markup on screen instead of hand-positioning the text a
// second time. Client-only.

// The "-pro" fork, not the original html2canvas: the original can't parse
// the oklch()/lab() color functions Tailwind CSS v4 generates by default,
// and throws on every capture as a result.
import html2canvas from "html2canvas-pro";
import { jsPDF } from "jspdf";

export async function buildPagePdf(node: HTMLElement, filename: string): Promise<File> {
  const canvas = await html2canvas(node, { scale: 2, backgroundColor: "#ffffff" });
  // JPEG, not PNG: a lossless page image made a ~3MB PDF, too big to email
  // comfortably; at this quality the text stays crisp at a few percent of the size.
  const imageData = canvas.toDataURL("image/jpeg", 0.92);

  const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const imageHeight = (canvas.height * pageWidth) / canvas.width;
  // The same image on each page, shifted up a page at a time.
  for (let top = 0; top < imageHeight; top += pageHeight) {
    if (top > 0) pdf.addPage();
    pdf.addImage(imageData, "JPEG", 0, -top, pageWidth, imageHeight);
  }

  const blob = pdf.output("blob");
  return new File([blob], filename, { type: "application/pdf" });
}
