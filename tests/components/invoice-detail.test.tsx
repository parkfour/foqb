import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { html2canvasMock, jsPDFMock } = vi.hoisted(() => {
  const fakeCanvas = { toDataURL: () => "data:image/png;base64,fake", width: 800, height: 1000 };
  const addImageMock = vi.fn();
  return {
    html2canvasMock: vi.fn(async () => fakeCanvas),
    jsPDFMock: vi.fn().mockImplementation(function jsPDFCtor() {
      return {
        internal: { pageSize: { getWidth: () => 612 } },
        addImage: addImageMock,
        output: (type: string) =>
          type === "blob" ? new Blob(["pdf"], { type: "application/pdf" }) : "",
      };
    }),
  };
});

vi.mock("html2canvas-pro", () => ({ default: html2canvasMock }));
vi.mock("jspdf", () => ({ jsPDF: jsPDFMock }));

import { InvoiceDetail } from "@/components/customers/invoice-detail";

const baseProps = {
  invoiceId: "00000000-0000-0000-0000-000000000001",
  organizationName: "Acme Consulting",
  invoiceNumber: "INV-1",
  invoiceDate: "2026-09-19",
  dueDate: "2026-10-19",
  status: "open" as const,
  customer: { name: "Acme Corp", email: "billing@acme.test", billing_address: null },
  lines: [{ description: "Widget", quantity: 2, unit_price: 25, amount: 50 }],
  subtotal: 50,
  taxRate: 0,
  taxAmount: 0,
  total: 50,
  remaining: 50,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  Reflect.deleteProperty(navigator, "share");
  Reflect.deleteProperty(navigator, "canShare");
});

describe("InvoiceDetail", () => {
  it("shows a tax line only when tax was charged", () => {
    render(<InvoiceDetail {...baseProps} />);
    expect(screen.queryByText(/^Tax/)).not.toBeInTheDocument();
    cleanup();

    render(
      <InvoiceDetail
        {...baseProps}
        taxRate={10}
        taxAmount={5}
        total={55}
        remaining={55}
      />,
    );
    expect(screen.getByText("Tax (10%)")).toBeInTheDocument();
    expect(screen.getAllByText("$5.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$55.00").length).toBeGreaterThan(0);
  });

  it("renders the invoice content", () => {
    render(<InvoiceDetail {...baseProps} />);

    expect(screen.getByText("Acme Consulting")).toBeInTheDocument();
    expect(screen.getByText("Acme Corp")).toBeInTheDocument();
    expect(screen.getByText("Widget")).toBeInTheDocument();
    expect(screen.getAllByText("$50.00").length).toBeGreaterThan(0);
  });

  it("sizes a normal-resolution logo to a quarter of the invoice width", () => {
    const { container } = render(
      <InvoiceDetail {...baseProps} organizationLogoDataUrl="data:image/png;base64,fake" />,
    );
    const img = container.querySelector("img") as HTMLImageElement;
    Object.defineProperty(img, "naturalWidth", { value: 400, configurable: true });
    fireEvent.load(img);

    expect(img.className).toContain("w-1/4");
    expect(img.className).not.toContain("max-w-[25%]");
  });

  it("shows a low-resolution logo at its native size instead of upscaling it", () => {
    const { container } = render(
      <InvoiceDetail {...baseProps} organizationLogoDataUrl="data:image/png;base64,fake" />,
    );
    const img = container.querySelector("img") as HTMLImageElement;
    Object.defineProperty(img, "naturalWidth", { value: 40, configurable: true });
    fireEvent.load(img);

    expect(img.className).toContain("max-w-[25%]");
    expect(img.className).not.toContain("w-1/4");
  });

  it("shares the generated PDF via the Web Share API when supported", async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true });
    Object.defineProperty(navigator, "share", { value: shareMock, configurable: true });

    render(<InvoiceDetail {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /download.*share pdf/i }));

    await waitFor(() => expect(shareMock).toHaveBeenCalledTimes(1));

    const call = shareMock.mock.calls[0][0] as { files: File[]; title: string };
    expect(call.files[0].name).toBe("Invoice-INV-1.pdf");
    expect(call.title).toContain("INV-1");
  });

  it("falls back to a download when the Web Share API is unavailable", async () => {
    // jsdom doesn't implement URL.createObjectURL/revokeObjectURL at all —
    // stub them so the download branch can run in this environment.
    URL.createObjectURL = vi.fn(() => "blob:fake");
    URL.revokeObjectURL = vi.fn();
    Object.defineProperty(navigator, "canShare", { value: undefined, configurable: true });
    // Some browsers silently no-op a download click on a detached <a> — the
    // link must be in the document when .click() runs, not just created.
    let wasConnectedAtClickTime = false;
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        wasConnectedAtClickTime = this.isConnected;
      });

    render(<InvoiceDetail {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /download.*share pdf/i }));

    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
    expect(wasConnectedAtClickTime).toBe(true);
    clickSpy.mockRestore();
  });
});
