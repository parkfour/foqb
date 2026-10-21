"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { useMoney } from "@/components/providers/book-currency-provider";

export interface BreakdownLine {
  name: string;
  amount: number;
  href?: string;
}

export interface BreakdownSection {
  heading?: string;
  lines: BreakdownLine[];
}

export interface Breakdown {
  title: string;
  total: number;
  sections: BreakdownSection[];
}

// What's in a figure on the dashboard: each account or property behind it,
// linked to where it's kept. Opens while `breakdown` is set.
export function BreakdownDialog({ breakdown, onClose }: { breakdown: Breakdown | null; onClose: () => void }) {
  const formatCurrency = useMoney();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (breakdown && !dialog.open) dialog.showModal();
    if (!breakdown && dialog.open) dialog.close();
  }, [breakdown]);

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      // A click on the backdrop (the dialog element itself) closes it.
      onClick={(e) => e.target === dialogRef.current && dialogRef.current?.close()}
      aria-labelledby="breakdown-title"
      className="w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-slate-200 p-0 shadow-lg backdrop:bg-slate-900/40"
    >
      {breakdown && (
        <div className="flex max-h-[80vh] flex-col">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h2 id="breakdown-title" className="text-sm font-semibold text-slate-900">
              {breakdown.title}
            </h2>
            <span className="font-mono text-sm font-bold text-slate-900">{formatCurrency(breakdown.total)}</span>
          </div>
          <div className="overflow-y-auto px-5 py-3">
            {breakdown.sections.map((section, i) => (
              <section key={section.heading ?? i} className="py-2">
                {section.heading && (
                  <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{section.heading}</h3>
                )}
                {section.lines.length === 0 ? (
                  <p className="py-1 text-xs text-slate-400">Nothing here.</p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {section.lines.map((line, j) => (
                      <li key={`${line.name}-${j}`} className="flex items-center justify-between gap-3 py-2 text-xs">
                        {line.href ? (
                          <Link href={line.href} className="text-slate-800 hover:underline">
                            {line.name}
                          </Link>
                        ) : (
                          <span className="text-slate-800">{line.name}</span>
                        )}
                        <span className="font-mono text-slate-900">{formatCurrency(line.amount)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
          <div className="border-t border-slate-100 px-5 py-3 text-right">
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
