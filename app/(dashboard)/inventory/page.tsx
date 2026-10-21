import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { ReadOnlyNotice } from "@/components/ui/read-only-notice";
import { NewItemForm } from "@/components/inventory/new-item-form";
import { createClient } from "@/lib/supabase/server";
import { canWrite, getCurrentOrgId, getCurrentUserRole, getUseAccountCodes } from "@/lib/org/current";
import { formatAccountLabel } from "@/lib/accounts/format";
import { adjustInventoryQuantity, toggleInventoryItemActive, deleteInventoryItem } from "./actions";
import { formatMoney } from "@/lib/money";
import { getBookCurrency } from "@/lib/org/book-currency";

interface AccountOption {
  id: string;
  account_number: string;
  name: string;
}

interface InventoryItemRow {
  id: string;
  sku: string;
  name: string;
  quantity_on_hand: number;
  unit_cost: number;
  is_active: boolean;
  accounts: { account_number: string; name: string } | null;
}

export default async function InventoryPage() {
  const orgId = await getCurrentOrgId();
  const currency = await getBookCurrency(orgId);


  if (!orgId) {
    return (
      <div>
        <PageHeader title="Inventory" description="Track items on hand and their cost." />
        <p className="text-sm text-slate-500">Create an organization first.</p>
      </div>
    );
  }

  const supabase = await createClient();

  const { data: orgData } = await supabase
    .from("organizations")
    .select("inventory_enabled")
    .eq("id", orgId)
    .maybeSingle();

  if (!(orgData as { inventory_enabled: boolean } | null)?.inventory_enabled) {
    return (
      <div>
        <PageHeader title="Inventory" description="Track items on hand and their cost." />
        <p className="text-sm text-slate-500">
          Inventory is disabled for this organization. Enable it in Settings.
        </p>
      </div>
    );
  }

  const [{ data: accountsData }, { data: itemsData }, role, showAccountCodes] = await Promise.all([
    supabase
      .from("accounts")
      .select("id, account_number, name")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .order("account_number"),
    supabase
      .from("inventory_items")
      .select("id, sku, name, quantity_on_hand, unit_cost, is_active, accounts(account_number, name)")
      .eq("organization_id", orgId)
      .order("sku"),
    getCurrentUserRole(orgId),
    getUseAccountCodes(orgId),
  ]);

  const accounts = (accountsData as AccountOption[] | null) ?? [];
  const items = (itemsData as unknown as InventoryItemRow[] | null) ?? [];
  const userCanWrite = canWrite(role);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Inventory" description="Track items on hand and their cost." />

      <p className="text-sm text-slate-500">
        This tracks warehouse quantity and cost. To invoice customers for something, add it to{" "}
        <Link href="/items" className="underline hover:text-slate-900">
          Items
        </Link>{" "}
        instead (or as well).
      </p>

      {userCanWrite ? (
        <NewItemForm organizationId={orgId} accounts={accounts} showAccountCodes={showAccountCodes} />
      ) : (
        <ReadOnlyNotice />
      )}

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">SKU</th>
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Quantity</th>
                <th className="px-5 py-3 font-medium">Unit Cost</th>
                <th className="px-5 py-3 font-medium">Asset Account</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-6 text-center text-slate-500">
                    No inventory items yet.
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-5 py-3 text-slate-900">{item.sku}</td>
                    <td className="px-5 py-3 text-slate-600">{item.name}</td>
                    <td className="px-5 py-3">
                      {userCanWrite ? (
                        <form action={adjustInventoryQuantity} className="flex items-center gap-2">
                          <input type="hidden" name="id" value={item.id} />
                          <input
                            name="quantityOnHand"
                            type="number"
                            step="0.01"
                            defaultValue={item.quantity_on_hand}
                            className="w-24 rounded-md border border-slate-300 px-2 py-1 text-sm"
                          />
                          <button
                            type="submit"
                            className="text-sm text-slate-400 hover:text-slate-900"
                          >
                            Save
                          </button>
                        </form>
                      ) : (
                        item.quantity_on_hand
                      )}
                    </td>
                    <td className="px-5 py-3 text-slate-600">{formatMoney(item.unit_cost, currency)}</td>
                    <td className="px-5 py-3 text-slate-600">
                      {item.accounts ? formatAccountLabel(item.accounts, showAccountCodes) : "—"}
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
                          <form action={toggleInventoryItemActive}>
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
                          <form action={deleteInventoryItem}>
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
