import { createClient } from "@/lib/supabase/server";
import { formatAccountLabel } from "@/lib/accounts/format";
import { canWrite, getCurrentUserRole, getUseAccountCodes } from "@/lib/org/current";
import { formatMoney } from "@/lib/money";
import { getBookCurrency } from "@/lib/org/book-currency";
import { exchangeRate } from "@/lib/plugins/server-loader";
import { RevalueForm } from "./revalue-form";

interface ForeignBalance {
  account_id: string;
  account_number: string;
  name: string;
  type: "asset" | "liability";
  currency: string;
  foreign_balance: number;
  book_balance: number;
}

// Accounts in another currency: their balance there, what the books carry
// them at, and a revaluation to a rate (a plugin's quote when there is one).
export async function ForeignBalancesReport({ orgId, asOf }: { orgId: string; asOf: string }) {
  const supabase = await createClient();
  const [currency, { data, error }, { data: accounts }, role, showAccountCodes] = await Promise.all([
    getBookCurrency(orgId),
    supabase.rpc("get_foreign_balances", { p_org_id: orgId, p_as_of_date: asOf }),
    supabase
      .from("accounts")
      .select("id, account_number, name")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .in("type", ["revenue", "expense"])
      .order("account_number"),
    getCurrentUserRole(orgId),
    getUseAccountCodes(orgId),
  ]);
  if (error) throw error;
  const rows = (data ?? []) as ForeignBalance[];
  const rates = await Promise.all(rows.map((r) => exchangeRate(r.currency, currency)));
  const userCanWrite = canWrite(role);

  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-5 py-4">
        <h2 className="text-sm font-semibold text-slate-900">Foreign Currency Balances as of {asOf}</h2>
        <p className="mt-1 text-xs text-slate-500">
          Accounts kept in another currency than the book&apos;s {currency}. Revaluing books the difference to an exchange
          gain or loss account as of {asOf}.
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="px-5 py-6 text-center text-sm text-slate-500">
          No accounts in another currency. Give an asset or liability account a currency when you add it.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">Account</th>
                <th className="px-5 py-3 text-right font-medium">Balance</th>
                <th className="px-5 py-3 text-right font-medium">Carried at</th>
                <th className="px-5 py-3 text-right font-medium">Rate</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const foreign = Number(r.foreign_balance);
                const book = Number(r.book_balance);
                return (
                  <tr key={r.account_id} className="border-b border-slate-100 last:border-0">
                    <td className="px-5 py-3 text-slate-900">{formatAccountLabel(r, showAccountCodes)}</td>
                    <td className="px-5 py-3 text-right text-slate-900">{formatMoney(foreign, r.currency)}</td>
                    <td className="px-5 py-3 text-right text-slate-900">{formatMoney(book, currency)}</td>
                    <td className="px-5 py-3 text-right text-slate-600">
                      {foreign ? (book / foreign).toFixed(4) : "—"}
                      {rates[i] && <span className="block text-xs text-slate-500">now {rates[i]!.rate} ({rates[i]!.asOf})</span>}
                    </td>
                    <td className="px-5 py-3">
                      {userCanWrite && (
                        <RevalueForm
                          accountId={r.account_id}
                          asOf={asOf}
                          suggestedRate={rates[i]?.rate ?? null}
                          gainLossAccounts={accounts ?? []}
                          showAccountCodes={showAccountCodes}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
