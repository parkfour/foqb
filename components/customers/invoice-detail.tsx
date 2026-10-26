"use client";

import { useRef, useState } from "react";
// The "-pro" fork, not the original html2canvas: the original can't parse
// the oklch()/lab() color functions Tailwind CSS v4 generates by default,
// and throws on every capture as a result.
import html2canvas from "html2canvas-pro";
import { jsPDF } from "jspdf";
import { shareOrDownloadFile } from "@/lib/pwa/share-or-download";
import { PluginSlot } from "@/components/plugins/plugin-slot";
import { useMoney } from "@/components/providers/book-currency-provider";

interface CustomerInfo {
  name: string;
  email: string | null;
  billing_address: string | null;
}

interface LineItem {
  description: string | null;
  quantity: number;
  unit_price: number;
  amount: number;
}

interface InvoiceDetailProps {
  invoiceId: string;
  organizationName: string;
  organizationLogoDataUrl?: string | null;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string | null;
  status: "open" | "partial" | "paid" | "void";
  customer: CustomerInfo | null;
  lines: LineItem[];
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  // One line per rate applied; empty for invoices made before named rates.
  taxes: { name: string; rate: number; amount: number }[];
  total: number;
  remaining: number;
  // Printed at the foot, from the book's plugins (a VAT number, "Reverse charge").
  notes?: string[];
}

// Renders the invoice to an off-DOM canvas (html2canvas) and embeds that as
// a single page in a jsPDF document — chosen over a text-drawn PDF because
// it reuses the exact same styled markup below instead of hand-positioning
// text/tables a second time.
async function buildInvoicePdf(node: HTMLElement, filename: string): Promise<File> {
  const canvas = await html2canvas(node, { scale: 2, backgroundColor: "#ffffff" });
  // JPEG, not PNG: a lossless page image made a ~3MB PDF, too big to email
  // comfortably; at this quality the text stays crisp at a few percent of the size.
  const imageData = canvas.toDataURL("image/jpeg", 0.92);

  const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = (canvas.height * pageWidth) / canvas.width;
  pdf.addImage(imageData, "JPEG", 0, 0, pageWidth, pageHeight);

  const blob = pdf.output("blob");
  return new File([blob], filename, { type: "application/pdf" });
}

// The printable area is `max-w-2xl` (42rem) minus `p-8` padding on each
// side, so ~608px wide — a quarter of that is roughly this many px. Below
// that native pixel width, forcing the logo up to 25% would upscale it
// past its own resolution and look blurry, so it's shown at native size
// (capped at 25% either way) instead.
const LOGO_TARGET_WIDTH_PX = 150;

export function InvoiceDetail({
  invoiceId,
  organizationName,
  organizationLogoDataUrl,
  invoiceNumber,
  invoiceDate,
  dueDate,
  status,
  customer,
  lines,
  subtotal,
  taxRate,
  taxAmount,
  taxes,
  total,
  remaining,
  notes = [],
}: InvoiceDetailProps) {
  const formatCurrency = useMoney();
  const printableRef = useRef<HTMLDivElement>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logoIsHighRes, setLogoIsHighRes] = useState(true);

  async function buildPdf(): Promise<File> {
    if (!printableRef.current) throw new Error("The invoice isn't on screen yet");
    return buildInvoicePdf(printableRef.current, `Invoice-${invoiceNumber}.pdf`);
  }

  async function handleShareOrDownload() {
    setError(null);
    setIsGenerating(true);

    try {
      const file = await buildPdf();

      await shareOrDownloadFile(file, {
        title: `Invoice ${invoiceNumber}`,
        text: `Invoice ${invoiceNumber} from ${organizationName}`,
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to generate PDF");
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">Invoice {invoiceNumber}</h1>
        <div className="flex items-center gap-2">
          <PluginSlot
            name="invoice.actions"
            context={{
              invoiceId,
              invoiceNumber,
              customer: customer ? { name: customer.name, email: customer.email } : null,
              total,
              remaining,
              dueDate,
              status,
              buildPdf,
            }}
          />
          <button
            type="button"
            onClick={handleShareOrDownload}
            disabled={isGenerating}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {isGenerating ? "Preparing…" : "Download / Share PDF"}
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div
        ref={printableRef}
        className="mx-auto w-full max-w-2xl rounded-lg border border-slate-200 bg-white p-8"
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            {organizationLogoDataUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- data: URI, not an optimizable asset
              <img
                src={organizationLogoDataUrl}
                alt=""
                onLoad={(e) => setLogoIsHighRes(e.currentTarget.naturalWidth >= LOGO_TARGET_WIDTH_PX)}
                className={`h-auto rounded-md border border-slate-100 ${logoIsHighRes ? "w-1/4" : "w-auto max-w-[25%]"}`}
              />
            )}
            <p className="text-lg font-semibold text-slate-900">{organizationName}</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-semibold text-slate-900">Invoice</p>
            <p className="text-sm text-slate-500">{invoiceNumber}</p>
          </div>
        </div>

        <div className="mt-6 flex justify-between text-sm">
          <div>
            <p className="font-medium text-slate-500">Bill To</p>
            <p className="mt-1 text-slate-900">{customer?.name ?? "—"}</p>
            {customer?.email && <p className="text-slate-600">{customer.email}</p>}
            {customer?.billing_address && (
              <p className="whitespace-pre-line text-slate-600">{customer.billing_address}</p>
            )}
          </div>
          <div className="text-right">
            <p>
              <span className="font-medium text-slate-500">Date: </span>
              {invoiceDate}
            </p>
            {dueDate && (
              <p>
                <span className="font-medium text-slate-500">Due: </span>
                {dueDate}
              </p>
            )}
            <p className="capitalize">
              <span className="font-medium text-slate-500">Status: </span>
              {status}
            </p>
          </div>
        </div>

        <table className="mt-6 w-full text-sm">
          <thead>
            <tr className="border-b border-slate-300 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="py-2 font-medium">Description</th>
              <th className="py-2 text-right font-medium">Qty</th>
              <th className="py-2 text-right font-medium">Unit Price</th>
              <th className="py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr key={index} className="border-b border-slate-100">
                <td className="py-2 text-slate-900">{line.description || "—"}</td>
                <td className="py-2 text-right text-slate-600">{line.quantity}</td>
                <td className="py-2 text-right text-slate-600">
                  {formatCurrency(line.unit_price)}
                </td>
                <td className="py-2 text-right text-slate-900">{formatCurrency(line.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 flex flex-col items-end gap-1 text-sm">
          <p className="flex w-48 justify-between">
            <span className="text-slate-500">Subtotal</span>
            <span className="text-slate-900">{formatCurrency(subtotal)}</span>
          </p>
          {taxes.length > 0
            ? taxes.map((tax) => (
                <p key={tax.name} className="flex w-48 justify-between gap-2">
                  <span className="text-slate-500">
                    {tax.name} ({tax.rate}%)
                  </span>
                  <span className="text-slate-900">{formatCurrency(tax.amount)}</span>
                </p>
              ))
            : taxAmount > 0 && (
                <p className="flex w-48 justify-between">
                  <span className="text-slate-500">Tax ({taxRate}%)</span>
                  <span className="text-slate-900">{formatCurrency(taxAmount)}</span>
                </p>
              )}
          <p className="flex w-48 justify-between">
            <span className="text-slate-500">Total</span>
            <span className="font-medium text-slate-900">{formatCurrency(total)}</span>
          </p>
          {status !== "void" && (
            <p className="flex w-48 justify-between border-t border-slate-200 pt-1">
              <span className="text-slate-500">Balance Due</span>
              <span className="font-semibold text-slate-900">{formatCurrency(remaining)}</span>
            </p>
          )}
        </div>
        {notes.length > 0 && (
          <div className="mt-8 border-t border-slate-200 pt-3 text-xs text-slate-600">
            {notes.map((note) => (
              <p key={note}>{note}</p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
