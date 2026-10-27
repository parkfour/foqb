import { PageHeader } from "@/components/ui/page-header";
import { PluginSlot } from "@/components/plugins/plugin-slot";
import { createClient } from "@/lib/supabase/server";
import { canWrite, getCurrentOrgId, getCurrentUserRole } from "@/lib/org/current";
import { createPropertyAction, deletePropertyAction, updatePropertyValueAction } from "./actions";
import { formatTimestampDate } from "@/lib/time/book-time";
import { getBookClock } from "@/lib/org/book-clock";
import { formatMoney } from "@/lib/money";
import { getBookCurrency } from "@/lib/org/book-currency";

interface PropertyRow {
  id: string;
  name: string;
  kind: "real_estate" | "other";
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  purchase_price: number | null;
  purchase_date: string | null;
  estimated_value: number | null;
  last_valuation_at: string | null;
}

export default async function PropertiesPage() {
  const orgId = await getCurrentOrgId();
  const currency = await getBookCurrency(orgId);
  const formatCurrency = (value: number) => formatMoney(value, currency);
  const { timeZone } = await getBookClock(orgId);

  if (!orgId) {
    return (
      <div>
        <PageHeader title="Properties & Assets" description="Real estate and manual assets tracking." />
        <p className="mt-4 text-sm text-slate-500">Select or create an organization first.</p>
      </div>
    );
  }

  const role = await getCurrentUserRole(orgId);
  const writable = canWrite(role);

  const supabase = await createClient();
  const { data: propertiesData } = await supabase
    .from("properties")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

interface PropertyDatabaseRow {
  id: string;
  name: string;
  kind?: string | null;
  address_street?: string | null;
  address_city?: string | null;
  address_state?: string | null;
  address_zip?: string | null;
  purchase_price?: number | string | null;
  purchase_date?: string | null;
  estimated_value?: number | string | null;
  last_valuation_at?: string | null;
}

  const rows: PropertyRow[] = ((propertiesData as unknown as PropertyDatabaseRow[]) ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    kind: p.kind === "other" ? "other" : "real_estate",
    address_street: p.address_street ?? null,
    address_city: p.address_city ?? null,
    address_state: p.address_state ?? null,
    address_zip: p.address_zip ?? null,
    purchase_price: p.purchase_price ? Number(p.purchase_price) : null,
    purchase_date: p.purchase_date ?? null,
    estimated_value: p.estimated_value ? Number(p.estimated_value) : null,
    last_valuation_at: p.last_valuation_at ?? null,
  }));

  const properties = rows.filter((p) => p.kind === "real_estate");
  const otherAssets = rows.filter((p) => p.kind === "other");
  const otherTotal = otherAssets.reduce((sum, a) => sum + Number(a.estimated_value || 0), 0);

  const totalValue = properties.reduce((sum, p) => sum + Number(p.estimated_value || 0), 0);
  const totalCost = properties.reduce(
    (sum, p) => sum + Number(p.purchase_price || p.estimated_value || 0),
    0,
  );
  const totalAppreciation = totalValue - totalCost;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Properties & Assets"
        description="Your home and other property, at the value you give them. Counted in net worth alongside your accounts, so don't also add them as an asset account."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Total Real Estate Assets</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{formatCurrency(totalValue)}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Total Cost / Basis</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{formatCurrency(totalCost)}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Net Estimated Appreciation</p>
          <p className={`mt-2 text-2xl font-bold ${totalAppreciation >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
            {totalAppreciation >= 0 ? "+" : ""}
            {formatCurrency(totalAppreciation)}
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-6 py-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Tracked Properties</h2>
        </div>

        {properties.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No real estate properties tracked yet. Add your primary residence or investment real estate below.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <tr>
                  <th className="px-6 py-3">Property Name</th>
                  <th className="px-6 py-3">Address</th>
                  <th className="px-6 py-3 text-right">Purchase Price</th>
                  <th className="px-6 py-3 text-right">Estimated Value</th>
                  <th className="px-6 py-3">Value Updated</th>
                  {writable && <th className="px-6 py-3 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {properties.map((prop) => (
                  <tr key={prop.id} className="hover:bg-slate-50/50">
                    <td className="px-6 py-4 font-semibold text-slate-900">{prop.name}</td>
                    <td className="px-6 py-4 text-xs text-slate-600">
                      {prop.address_street
                        ? `${prop.address_street}, ${prop.address_city || ""} ${prop.address_state || ""} ${
                            prop.address_zip || ""
                          }`
                        : "No address specified"}
                    </td>
                    <td className="px-6 py-4 text-right font-mono text-slate-700">
                      {prop.purchase_price ? formatCurrency(prop.purchase_price) : "—"}
                    </td>
                    <td className="px-6 py-4 text-right font-mono font-bold text-slate-900">
                      {formatCurrency(prop.estimated_value || 0)}
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-500">
                      {prop.last_valuation_at ? formatTimestampDate(prop.last_valuation_at, timeZone) : "—"}
                    </td>
                    {writable && <ValueActions id={prop.id} name={prop.name} />}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Other Assets</h2>
            <p className="mt-1 text-xs text-slate-500">
              Anything else of value you want counted in net worth: collectibles, jewelry, art, a vehicle.
            </p>
          </div>
          {otherAssets.length > 0 && <p className="text-sm font-bold text-slate-900">{formatCurrency(otherTotal)}</p>}
        </div>
        {otherAssets.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-6 py-3">Asset</th>
                  <th className="px-6 py-3">Acquired</th>
                  <th className="px-6 py-3 text-right">Cost</th>
                  <th className="px-6 py-3 text-right">Value</th>
                  <th className="px-6 py-3">Value Updated</th>
                  {writable && <th className="px-6 py-3 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {otherAssets.map((asset) => (
                  <tr key={asset.id} className="hover:bg-slate-50/50">
                    <td className="px-6 py-4 font-semibold text-slate-900">{asset.name}</td>
                    <td className="px-6 py-4 text-xs text-slate-600">{asset.purchase_date ?? "—"}</td>
                    <td className="px-6 py-4 text-right font-mono text-slate-700">
                      {asset.purchase_price ? formatCurrency(asset.purchase_price) : "—"}
                    </td>
                    <td className="px-6 py-4 text-right font-mono font-bold text-slate-900">
                      {formatCurrency(asset.estimated_value || 0)}
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-500">
                      {asset.last_valuation_at ? formatTimestampDate(asset.last_valuation_at, timeZone) : "—"}
                    </td>
                    {writable && <ValueActions id={asset.id} name={asset.name} />}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {writable && (
          <form action={createPropertyAction} className="grid grid-cols-1 gap-4 border-t border-slate-200 p-6 sm:grid-cols-2 lg:grid-cols-5">
            <input type="hidden" name="kind" value="other" />
            <div>
              <label htmlFor="other-name" className="text-xs font-medium text-slate-700">Asset</label>
              <input id="other-name" name="name" required placeholder="e.g. Coin collection" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-xs" />
            </div>
            <div>
              <label htmlFor="other-estimatedValue" className="text-xs font-medium text-slate-700">Value ($)</label>
              <input id="other-estimatedValue" name="estimatedValue" type="number" step="0.01" min="0" required placeholder="12000" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-xs font-mono" />
            </div>
            <div>
              <label htmlFor="other-purchasePrice" className="text-xs font-medium text-slate-700">Cost ($, optional)</label>
              <input id="other-purchasePrice" name="purchasePrice" type="number" step="0.01" min="0" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-xs font-mono" />
            </div>
            <div>
              <label htmlFor="other-purchaseDate" className="text-xs font-medium text-slate-700">Acquired (optional)</label>
              <input id="other-purchaseDate" name="purchaseDate" type="date" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-xs" />
            </div>
            <div className="flex items-end">
              <button type="submit" className="w-full rounded-md bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800">
                Add Asset
              </button>
            </div>
          </form>
        )}
      </div>

      <PluginSlot
        name="properties.sections"
        context={{ organizationId: orgId, canWrite: writable, revision: new Date().toISOString() }}
        className="flex flex-col gap-6"
      />

      {writable && (
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">Add Property</h2>
          <form action={createPropertyAction} className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="text-xs font-medium text-slate-700">Property Name</label>
              <input
                name="name"
                required
                placeholder="e.g. Primary Residence, Beach House"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-xs"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-700">Street Address</label>
              <input
                name="street"
                placeholder="123 Main St"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-xs"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-700">City</label>
              <input
                name="city"
                placeholder="Austin"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-xs"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-700">State</label>
              <input
                name="state"
                placeholder="TX"
                maxLength={2}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-xs uppercase"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-700">ZIP Code</label>
              <input
                name="zip"
                placeholder="78701"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-xs"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-700">Purchase Price ($)</label>
              <input
                name="purchasePrice"
                type="number"
                step="0.01"
                placeholder="500000"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-xs font-mono"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-700">Estimated Value ($)</label>
              <input
                name="estimatedValue"
                type="number"
                step="0.01"
                placeholder="550000"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-xs font-mono"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-700">Purchase Date</label>
              <input
                name="purchaseDate"
                type="date"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-xs"
              />
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                className="w-full rounded-md bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
              >
                Add Property
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

// Update the value by hand, or remove it: for a property or another asset.
function ValueActions({ id, name }: { id: string; name: string }) {
  return (
    <td className="px-6 py-4 text-right">
      <div className="inline-flex items-center gap-2">
        <form action={updatePropertyValueAction} className="inline-flex items-center gap-1">
          <input type="hidden" name="propertyId" value={id} />
          <input
            name="estimatedValue"
            type="number"
            step="0.01"
            min="0"
            required
            aria-label={`New estimated value for ${name}`}
            placeholder="New value"
            className="w-28 rounded border border-slate-200 px-2 py-1 text-xs font-mono"
          />
          <button
            type="submit"
            className="rounded border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Update
          </button>
        </form>
        <form action={deletePropertyAction}>
          <input type="hidden" name="propertyId" value={id} />
          <button type="submit" className="rounded px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50">
            Remove
          </button>
        </form>
      </div>
    </td>
  );
}
