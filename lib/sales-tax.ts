// The taxes on an invoice from the rates applied to it, each rounded to
// the cent on its own (that's what each agency is owed).

export interface SalesTaxRate {
  id: string;
  name: string;
  rate: number;
  account_id: string | null;
}

export interface AppliedTax {
  tax_rate_id: string;
  name: string;
  rate: number;
  amount: number;
  account_id: string | null;
}

export function applyTaxes(subtotal: number, rates: SalesTaxRate[]): { taxes: AppliedTax[]; totalRate: number; totalTax: number } {
  const taxes = rates.map((r) => ({
    tax_rate_id: r.id,
    name: r.name,
    rate: Number(r.rate),
    amount: Math.round(subtotal * Number(r.rate)) / 100,
    account_id: r.account_id,
  }));
  return {
    taxes,
    totalRate: Math.round(taxes.reduce((s, t) => s + t.rate, 0) * 1000) / 1000,
    totalTax: Math.round(taxes.reduce((s, t) => s + t.amount, 0) * 100) / 100,
  };
}
