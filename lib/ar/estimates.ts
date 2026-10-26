// An estimate's lines before tax, rounded per line as an invoice rounds them.
export function estimateSubtotal(lines: { quantity: number; unit_price: number }[]): number {
  return lines.reduce((sum, l) => sum + Math.round(Number(l.quantity) * Number(l.unit_price) * 100) / 100, 0);
}

export const ESTIMATE_STATUS_STYLES: Record<string, string> = {
  open: "bg-amber-100 text-amber-800",
  accepted: "bg-sky-100 text-sky-800",
  declined: "bg-slate-100 text-slate-600",
  invoiced: "bg-emerald-100 text-emerald-800",
};
