import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { createClient } from "@/lib/supabase/server";
import { canWrite, getCurrentOrgId, getCurrentUserRole } from "@/lib/org/current";
import { monthlyDepreciationAmount } from "@/lib/fixed-assets/depreciate";
import { deleteFixedAsset, recordDepreciationNow } from "./actions";
import { bookToday } from "@/lib/org/book-clock";
import { formatMoney } from "@/lib/money";
import { getBookCurrency } from "@/lib/org/book-currency";

interface FixedAssetRow {
  id: string;
  name: string;
  cost: number;
  salvage_value: number;
  useful_life_months: number;
  accumulated_months: number;
  next_depreciation_date: string;
}

export default async function FixedAssetsPage() {
  const orgId = await getCurrentOrgId();
  const currency = await getBookCurrency(orgId);
  const formatCurrency = (value: number) => formatMoney(value, currency);

  if (!orgId) {
    return (
      <div>
        <PageHeader title="Fixed Assets" description="Straight-line depreciation schedules." />
        <p className="text-sm text-slate-500">Create an organization first.</p>
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data }, role] = await Promise.all([
    supabase
      .from("fixed_assets")
      .select(
        "id, name, cost, salvage_value, useful_life_months, accumulated_months, next_depreciation_date",
      )
      .eq("organization_id", orgId)
      .order("name"),
    getCurrentUserRole(orgId),
  ]);

  const assets = (data as FixedAssetRow[] | null) ?? [];
  const userCanWrite = canWrite(role);
  const todayDate = await bookToday(orgId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <PageHeader title="Fixed Assets" description="Straight-line depreciation schedules." />
        {userCanWrite && (
          <Link
            href="/fixed-assets/new"
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            New Fixed Asset
          </Link>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">Asset</th>
                <th className="px-5 py-3 text-right font-medium">Cost</th>
                <th className="px-5 py-3 text-right font-medium">Accumulated Depr.</th>
                <th className="px-5 py-3 text-right font-medium">Net Book Value</th>
                <th className="px-5 py-3 font-medium">Next Date</th>
                <th className="px-5 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {assets.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-6 text-center text-slate-500">
                    No fixed assets yet.
                  </td>
                </tr>
              ) : (
                assets.map((asset) => {
                  const monthly = monthlyDepreciationAmount(asset);
                  const accumulatedDepreciation = monthly * asset.accumulated_months;
                  const netBookValue = Number(asset.cost) - accumulatedDepreciation;
                  const fullyDepreciated = asset.accumulated_months >= asset.useful_life_months;
                  const isDue = !fullyDepreciated && asset.next_depreciation_date <= todayDate;

                  return (
                    <tr key={asset.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-5 py-3 text-slate-900">{asset.name}</td>
                      <td className="px-5 py-3 text-right text-slate-600">
                        {formatCurrency(Number(asset.cost))}
                      </td>
                      <td className="px-5 py-3 text-right text-slate-600">
                        {formatCurrency(accumulatedDepreciation)}
                      </td>
                      <td className="px-5 py-3 text-right text-slate-900">
                        {formatCurrency(netBookValue)}
                      </td>
                      <td className="px-5 py-3 text-slate-600">
                        {fullyDepreciated ? (
                          "Fully depreciated"
                        ) : (
                          <>
                            {asset.next_depreciation_date}
                            {isDue && (
                              <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                                Due
                              </span>
                            )}
                          </>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-3">
                          {userCanWrite && isDue && (
                            <form action={recordDepreciationNow}>
                              <input type="hidden" name="id" value={asset.id} />
                              <input type="hidden" name="organizationId" value={orgId} />
                              <button
                                type="submit"
                                className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
                              >
                                Record Depreciation
                              </button>
                            </form>
                          )}
                          {userCanWrite && (
                            <form action={deleteFixedAsset}>
                              <input type="hidden" name="id" value={asset.id} />
                              <button
                                type="submit"
                                className="text-xs text-slate-400 hover:text-red-600"
                              >
                                Delete
                              </button>
                            </form>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
