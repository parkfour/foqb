import { describe, expect, it, vi } from "vitest";

const { addImage, addPage } = vi.hoisted(() => ({ addImage: vi.fn(), addPage: vi.fn() }));

// A page image 3,000 px tall at 1,000 px wide: on a 612 × 792 pt letter
// page it is 1,836 pt tall, so three pages.
vi.mock("html2canvas-pro", () => ({
  default: vi.fn(async () => ({ toDataURL: () => "data:image/jpeg;base64,x", width: 1000, height: 3000 })),
}));
vi.mock("jspdf", () => ({
  jsPDF: vi.fn().mockImplementation(function jsPDFCtor() {
    return {
      internal: { pageSize: { getWidth: () => 612, getHeight: () => 792 } },
      addImage,
      addPage,
      output: () => new Blob(["%PDF-"], { type: "application/pdf" }),
    };
  }),
}));

import { buildPagePdf } from "@/lib/pdf/page-pdf";

describe("buildPagePdf", () => {
  it("continues a long document onto more pages, shifting the image up a page each time", async () => {
    const file = await buildPagePdf(document.createElement("div"), "Statement.pdf");

    expect(file.name).toBe("Statement.pdf");
    expect(addPage).toHaveBeenCalledTimes(2);
    expect(addImage.mock.calls.map((c) => c[3])).toEqual([-0, -792, -1584]);
  });
});
