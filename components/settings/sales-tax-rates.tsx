import { addSalesTaxRate, setSalesTaxRateActive } from "@/app/(dashboard)/settings/sales-tax-actions";
import { formatAccountLabel } from "@/lib/accounts/format";
import { SalesTaxLookup } from "./sales-tax-lookup";

interface Rate {
  id: string;
  name: string;
  rate: number;
  account_id: string | null;
  is_active: boolean;
}

interface AccountOption {
  id: string;
  account_number: string;
  name: string;
}

export function SalesTaxRates({
  organizationId,
  rates,
  liabilityAccounts,
  canWrite,
  showAccountCodes,
  lookupSources = [],
}: {
  organizationId: string;
  rates: Rate[];
  liabilityAccounts: AccountOption[];
  canWrite: boolean;
  showAccountCodes: boolean;
  // Names of the book's plugins that look rates up by address.
  lookupSources?: string[];
}) {
  const accountName = (id: string | null) => {
    const account = liabilityAccounts.find((a) => a.id === id);
    return account ? formatAccountLabel(account, showAccountCodes) : "Sales Tax Payable control account";
  };

  return (
    <div id="sales-tax" className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">Sales tax rates</h2>
      <p className="mt-1 text-xs text-slate-500">
        One per tax you collect, such as the state&rsquo;s and the city&rsquo;s. An invoice can apply several. Give each
        agency its own liability account to see what each is owed; the Sales Tax report totals them. With no rates here,
        invoices take a single typed-in rate.
      </p>

      {rates.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {rates.map((r) => (
            <li key={r.id} className={`flex items-center justify-between gap-3 text-sm ${r.is_active ? "" : "text-slate-400"}`}>
              <span>
                {r.name} · {Number(r.rate)}% · {accountName(r.account_id)}
                {!r.is_active && " · retired"}
              </span>
              {canWrite && (
                <form action={setSalesTaxRateActive}>
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="active" value={String(!r.is_active)} />
                  <button type="submit" className="text-xs text-slate-500 hover:text-slate-900">
                    {r.is_active ? "Retire" : "Use again"}
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      {canWrite && (
        <form action={addSalesTaxRate} className="mt-3 flex flex-wrap items-end gap-2">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input name="name" placeholder="Name, e.g. Texas state" required maxLength={100} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
          <input
            name="rate"
            type="number"
            step="0.001"
            min="0.001"
            max="99.999"
            placeholder="Rate %"
            required
            className="w-24 rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <select name="accountId" defaultValue="" aria-label="Liability account" className="rounded-md border border-slate-300 px-3 py-2 text-sm">
            <option value="">Sales Tax Payable control account</option>
            {liabilityAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {formatAccountLabel(a, showAccountCodes)}
              </option>
            ))}
          </select>
          <button type="submit" className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800">
            Add rate
          </button>
        </form>
      )}
      {canWrite && lookupSources.length > 0 && <SalesTaxLookup organizationId={organizationId} sources={lookupSources} />}
    </div>
  );
}
