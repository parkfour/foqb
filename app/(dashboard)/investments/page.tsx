import { PageHeader } from "@/components/ui/page-header";
import { PriceForm, TradeForm, UpdatePricesButton } from "@/components/investments/investment-forms";
import { createClient } from "@/lib/supabase/server";
import { canWrite, getCurrentOrgId, getCurrentUserRole, getUseAccountCodes } from "@/lib/org/current";
import { bookToday } from "@/lib/org/book-clock";
import { formatMoney } from "@/lib/money";
import { getBookCurrency } from "@/lib/org/book-currency";
import { formatAccountLabel } from "@/lib/accounts/format";
import { fetchHoldings } from "@/lib/investments/value";
import { deleteTrade } from "./actions";

interface AccountRow {
  id: string;
  account_number: string;
  name: string;
  type: string;
}

interface TradeRow {
  id: string;
  trade_date: string;
  kind: "buy" | "sell";
  quantity: number;
  price: number;
  fees: number;
  journal_entry_id: string | null;
  securities: { symbol: string } | null;
  accounts: { name: string } | null;
}

export default async function InvestmentsPage() {
  const orgId = await getCurrentOrgId();
  const description = "What's in your brokerage and retirement accounts, and what it's worth.";
  if (!orgId) {
    return (
      <div>
        <PageHeader title="Investments" description={description} />
        <p className="text-sm text-slate-500">Create an organization first.</p>
      </div>
    );
  }

  const today = await bookToday(orgId);
  const supabase = await createClient();
  const [holdings, { data: accountData }, { data: tradeData }, role, currency, showAccountCodes] = await Promise.all([
    fetchHoldings(supabase, orgId, today),
    supabase
      .from("accounts")
      .select("id, account_number, name, type")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .is("currency", null)
      .in("type", ["asset", "revenue", "expense"])
      .order("account_number"),
    supabase
      .from("investment_trades")
      .select("id, trade_date, kind, quantity, price, fees, journal_entry_id, securities(symbol), accounts(name)")
      .eq("organization_id", orgId)
      .order("trade_date", { ascending: false })
      .limit(50),
    getCurrentUserRole(orgId),
    getBookCurrency(orgId),
    getUseAccountCodes(orgId),
  ]);
  const accounts = (accountData ?? []) as AccountRow[];
  const trades = (tradeData as unknown as TradeRow[] | null) ?? [];
  const formatCurrency = (value: number) => formatMoney(value, currency);
  const userCanWrite = canWrite(role);
  const assets = accounts.filter((a) => a.type === "asset");
  const accountName = new Map(accounts.map((a) => [a.id, formatAccountLabel(a, showAccountCodes)]));
  const open = holdings.filter((h) => h.quantity !== 0);
  const value = open.reduce((s, h) => s + h.value, 0);
  const cost = open.reduce((s, h) => s + h.cost, 0);
  const realized = holdings.reduce((s, h) => s + h.realized, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader title="Investments" description={description} />
        {userCanWrite && <UpdatePricesButton />}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          ["Market value", value],
          ["Gain not yet sold", value - cost],
          ["Gain from sales", realized],
        ].map(([label, amount]) => (
          <div key={label as string} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">{formatCurrency(amount as number)}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">Account</th>
                <th className="px-5 py-3 font-medium">Symbol</th>
                <th className="px-5 py-3 text-right font-medium">Shares</th>
                <th className="px-5 py-3 text-right font-medium">Price</th>
                <th className="px-5 py-3 text-right font-medium">Value</th>
                <th className="px-5 py-3 text-right font-medium">Cost</th>
                <th className="px-5 py-3 text-right font-medium">Gain</th>
              </tr>
            </thead>
            <tbody>
              {open.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-6 text-center text-slate-500">
                    No holdings yet. Record a trade below.
                  </td>
                </tr>
              ) : (
                open.map((h) => (
                  <tr key={`${h.account_id}:${h.security_id}`} className="border-b border-slate-100 last:border-0">
                    <td className="px-5 py-3 text-slate-600">{accountName.get(h.account_id) ?? "—"}</td>
                    <td className="px-5 py-3 text-slate-900">
                      {h.symbol}
                      {h.name && <span className="block text-xs text-slate-500">{h.name}</span>}
                    </td>
                    <td className="px-5 py-3 text-right text-slate-900">{h.quantity}</td>
                    <td className="px-5 py-3 text-right text-slate-900">
                      {h.price === null ? "—" : formatCurrency(h.price)}
                      {h.priceDate && <span className="block text-xs text-slate-500">{h.priceDate}</span>}
                    </td>
                    <td className="px-5 py-3 text-right text-slate-900">{formatCurrency(h.value)}</td>
                    <td className="px-5 py-3 text-right text-slate-600">{formatCurrency(h.cost)}</td>
                    <td className={`px-5 py-3 text-right ${h.value - h.cost < 0 ? "text-rose-600" : "text-emerald-700"}`}>
                      {formatCurrency(h.value - h.cost)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {userCanWrite && (
        <>
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-1 text-sm font-semibold text-slate-900">Record a trade</h2>
            <p className="mb-3 text-xs text-slate-500">
              The account&apos;s balance in the books stays what was paid; net worth counts it at market value.
            </p>
            <TradeForm
              investmentAccounts={assets}
              cashAccounts={assets}
              gainAccounts={accounts.filter((a) => a.type !== "asset")}
              showAccountCodes={showAccountCodes}
            />
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Set a price</h2>
            <PriceForm />
          </div>
        </>
      )}

      {trades.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <h2 className="border-b border-slate-200 px-5 py-3 text-sm font-semibold text-slate-900">Recent trades</h2>
          <table className="w-full text-sm">
            <tbody>
              {trades.map((t) => (
                <tr key={t.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-5 py-2 text-slate-600">{t.trade_date}</td>
                  <td className="px-5 py-2 text-slate-900">
                    {t.kind === "buy" ? "Bought" : "Sold"} {Number(t.quantity)} {t.securities?.symbol} at {formatCurrency(Number(t.price))}
                  </td>
                  <td className="px-5 py-2 text-slate-600">{t.accounts?.name}</td>
                  <td className="px-5 py-2 text-right">
                    {t.journal_entry_id ? (
                      <a href={`/journal/${t.journal_entry_id}`} className="text-sm text-slate-500 underline">
                        Booked
                      </a>
                    ) : (
                      userCanWrite && (
                        <form action={deleteTrade}>
                          <input type="hidden" name="id" value={t.id} />
                          <button type="submit" className="text-sm text-slate-400 hover:text-red-600">
                            Delete
                          </button>
                        </form>
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
