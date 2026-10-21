// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useState, type DragEvent } from "react";
import type { BillPrefill, SlotComponent } from "@/lib/plugins/types";
import { matchVendor, parseReceipt, type ParsedReceipt } from "./parse";
import { readReceipt, type ReceiptText } from "./read-receipt";
import { useMoney } from "@/components/providers/book-currency-provider";

// Below this, OCR has probably misread something.
const LOW_CONFIDENCE = 70;

function toPrefill(parsed: ParsedReceipt, vendorId: string | undefined): BillPrefill {
  const lines: NonNullable<BillPrefill["lines"]> = parsed.items
    ? [
        ...parsed.items,
        ...(parsed.tax ? [{ description: "Sales tax", quantity: 1, unitPrice: parsed.tax }] : []),
      ]
    : parsed.total !== undefined
      ? [{ description: parsed.vendorName ? `${parsed.vendorName} receipt` : "Receipt", quantity: 1, unitPrice: parsed.total }]
      : [];
  return {
    vendorId,
    billNumber: parsed.receiptNumber,
    billDate: parsed.date,
    lines: lines.length > 0 ? lines : undefined,
  };
}

interface Outcome {
  read: ReceiptText;
  notes: string[];
}

export const ReceiptScanner: SlotComponent<"bill.header"> = ({ context }) => {
  const formatCurrency = useMoney();
  const { vendors, prefill } = context;
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [dragging, setDragging] = useState(false);

  async function scan(file: File | undefined) {
    if (!file) return;
    setError(null);
    setOutcome(null);
    setProgress("Starting…");
    try {
      const read = await readReceipt(file, setProgress);
      const parsed = parseReceipt(read.text);
      const vendor = matchVendor(read.text, vendors);
      prefill(toPrefill(parsed, vendor?.id));

      const notes = [
        vendor
          ? `Vendor: ${vendor.name}`
          : parsed.vendorName
            ? `The receipt says “${parsed.vendorName}”, which isn't one of your vendors: choose or add one.`
            : "No vendor found: choose one.",
        parsed.date ? `Date: ${parsed.date}` : "No date found: check the bill date.",
        parsed.receiptNumber ? `Bill number: ${parsed.receiptNumber}` : "No receipt number found: enter a bill number.",
        parsed.items
          ? `${parsed.items.length} item${parsed.items.length === 1 ? "" : "s"}${parsed.tax ? " and sales tax" : ""}, adding up to ${formatCurrency(parsed.total as number)}.`
          : parsed.total !== undefined
            ? `One line for the total, ${formatCurrency(parsed.total)}. (The items didn't add up to it, so they weren't copied.)`
            : "No total found: enter the lines yourself.",
        "Choose an account for each line, check everything against the receipt, then save.",
      ];
      setOutcome({ read, notes });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read the receipt");
    } finally {
      setProgress(null);
    }
  }

  function onDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragging(false);
    void scan(e.dataTransfer.files[0]);
  }

  return (
    <div className="flex w-full flex-col gap-2">
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex cursor-pointer flex-col items-center gap-1 rounded-md border-2 border-dashed px-4 py-3 text-center text-sm ${dragging ? "border-slate-500 bg-slate-50" : "border-slate-300"} ${progress ? "pointer-events-none opacity-60" : ""}`}
      >
        <span className="font-medium text-slate-700">{progress ?? "Scan a receipt"}</span>
        <span className="text-xs text-slate-500">
          Drop a photo or PDF here, or tap to choose one. It&rsquo;s read on this device, never uploaded;
          the first scan downloads about 10 MB.
        </span>
        <input
          type="file"
          accept="image/*,application/pdf"
          className="sr-only"
          disabled={!!progress}
          onChange={(e) => {
            void scan(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </label>

      {error && <p className="rounded-md bg-red-50 p-2 text-xs text-red-700">{error}</p>}

      {outcome && (
        <div className="rounded-md bg-sky-50 p-3 text-xs text-sky-900">
          {outcome.read.confidence !== null && outcome.read.confidence < LOW_CONFIDENCE && (
            <p className="mb-1 font-medium text-amber-800">
              The picture was hard to read ({outcome.read.confidence}% confidence): check every number.
            </p>
          )}
          <ul className="list-disc pl-4">
            {outcome.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
          <details className="mt-2">
            <summary className="cursor-pointer">
              What was read{outcome.read.confidence !== null ? ` (${outcome.read.confidence}% confidence)` : " (from the PDF's text)"}
            </summary>
            <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded bg-white p-2 font-mono text-[11px] text-slate-700">
              {outcome.read.text}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
};
