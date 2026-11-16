"use client";

import { useRef, type ReactNode } from "react";
import { PluginSlot } from "@/components/plugins/plugin-slot";
import { PrintButton } from "@/components/ui/print-button";
import { buildPagePdf } from "@/lib/pdf/page-pdf";
import type { SlotContextMap } from "@/lib/plugins/types";

// A customer statement on screen, with its actions: the plugins' (emailing
// it, given the PDF of what's shown) and printing. The statement itself is
// rendered by the server page, as children.
export function StatementDocument({
  toolbar,
  context,
  fileName,
  children,
}: {
  toolbar: ReactNode;
  context: Omit<SlotContextMap["statement.actions"], "buildPdf">;
  fileName: string;
  children: ReactNode;
}) {
  const printableRef = useRef<HTMLDivElement>(null);

  async function buildPdf(): Promise<File> {
    if (!printableRef.current) throw new Error("The statement isn't on screen yet");
    return buildPagePdf(printableRef.current, fileName);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        {toolbar}
        <div className="flex items-center gap-4">
          <PluginSlot name="statement.actions" context={{ ...context, buildPdf }} />
          <PrintButton label="Print or save as PDF" />
        </div>
      </div>
      <div
        ref={printableRef}
        className="rounded-lg border border-slate-200 bg-white p-8 shadow-sm print:border-0 print:p-0 print:shadow-none"
      >
        {children}
      </div>
    </div>
  );
}
