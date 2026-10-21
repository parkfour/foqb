import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { CsvImportForm } from "@/components/csv/import-form";
import { createClient } from "@/lib/supabase/server";
import { canWrite, getCurrentOrgId, getCurrentUserRole, getUseAccountCodes } from "@/lib/org/current";
import { formatAccountLabel } from "@/lib/accounts/format";
import { toggleItemActive, deleteItem } from "./actions";

interface ItemRow {
  id: string;
  name: string;
  sale_price: number | null;
  track_quantity: boolean;
  quantity_on_hand: number;
  is_active: boolean;
  accounts: { account_number: string; name: string } | null;
}

export default async function ItemsPage() {
  const orgId = await getCurrentOrgId();

  if (!orgId) {
    return (
      <div>
        <PageHeader title="Items" description="Products and services, each tied to an income account." />
        <p className="text-sm text-slate-500">Create an organization first.</p>
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data }, { data: orgData }, role, showAccountCodes] = await Promise.all([
    supabase
      .from("items")
      .select(
        "id, name, sale_price, track_quantity, quantity_on_hand, is_active, accounts(account_number, name)",
      )
      .eq("organization_id", orgId)
      .order("name"),
    supabase.from("organizations").select("inventory_enabled").eq("id", orgId).maybeSingle(),
    getCurrentUserRole(orgId),
    getUseAccountCodes(orgId),
  ]);

  const items = (data as unknown as ItemRow[] | null) ?? [];
  const inventoryEnabled = (orgData as { inventory_enabled: boolean } | null)?.inventory_enabled ?? false;
  const userCanWrite = canWrite(role);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader title="Items" description="Products and services, each tied to an income account." />
        <div className="flex flex-wrap items-center gap-3">
          {userCanWrite && <CsvImportForm action="/api/import/items" label="Import CSV" />}
          {userCanWrite && (
            <Link
              href="/items/new"
              className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Add Item
            </Link>
          )}
        </div>
      </div>

      {inventoryEnabled && (
        <p className="text-sm text-slate-500">
          For warehouse quantity and cost tracking, see{" "}
          <a href="/inventory" className="underline hover:text-slate-900">
            Inventory
          </a>
          . Items here are for what you invoice customers.
        </p>
      )}

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Income Account</th>
                <th className="px-5 py-3 font-medium">Sale Price</th>
                <th className="px-5 py-3 font-medium">Quantity</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-6 text-center text-slate-500">
                    No items yet.
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-5 py-3 text-slate-900">
                      <Link href={`/items/${item.id}`} className="hover:underline">
                        {item.name}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-slate-600">
                      {item.accounts ? formatAccountLabel(item.accounts, showAccountCodes) : "—"}
                    </td>
                    <td className="px-5 py-3 text-slate-600">
                      {item.sale_price != null ? `$${item.sale_price.toFixed(2)}` : "—"}
                    </td>
                    <td className="px-5 py-3 text-slate-600">
                      {item.track_quantity ? item.quantity_on_hand : "—"}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                          item.is_active
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {item.is_active ? "active" : "inactive"}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      {userCanWrite && (
                        <div className="flex items-center justify-end gap-3">
                          <Link
                            href={`/items/${item.id}/edit`}
                            className="text-sm text-slate-400 hover:text-slate-900"
                          >
                            Edit
                          </Link>
                          <form action={toggleItemActive}>
                            <input type="hidden" name="id" value={item.id} />
                            <input
                              type="hidden"
                              name="isActive"
                              value={item.is_active ? "true" : "false"}
                            />
                            <button
                              type="submit"
                              className="text-sm text-slate-400 hover:text-slate-900"
                            >
                              {item.is_active ? "Disable" : "Enable"}
                            </button>
                          </form>
                          <form action={deleteItem}>
                            <input type="hidden" name="id" value={item.id} />
                            <button
                              type="submit"
                              className="text-sm text-slate-400 hover:text-red-600"
                            >
                              Delete
                            </button>
                          </form>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
