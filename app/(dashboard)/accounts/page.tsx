import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { ReadOnlyNotice } from "@/components/ui/read-only-notice";
import { DownloadButton } from "@/components/ui/download-button";
import { NewAccountForm } from "@/components/accounts/new-account-form";
import { DeleteAccountDialog } from "@/components/accounts/delete-account-dialog";
import { EditAccountDialog } from "@/components/accounts/edit-account-dialog";
import { TaxLineForm } from "@/components/accounts/tax-line-form";
import { CsvImportForm } from "@/components/csv/import-form";
import { createClient } from "@/lib/supabase/server";
import { canWrite, getCurrentOrgId, getCurrentUserRole, getUseAccountCodes } from "@/lib/org/current";
import { toggleAccountActive } from "./actions";
import { FORM_NAMES, PER_PROPERTY_FORM, TAX_FORM_LINES } from "@/lib/tax/forms";

interface AccountRow {
  id: string;
  account_number: string;
  name: string;
  type: string;
  is_active: boolean;
  tax_line_id: string | null;
  property_id: string | null;
  description: string | null;
}

interface TaxLineOption {
  id: string;
  form: string;
  code: string;
  label: string;
}

export default async function AccountsPage() {
  const orgId = await getCurrentOrgId();

  if (!orgId) {
    return (
      <div>
        <PageHeader title="Chart of Accounts" description="Account list and new account form." />
        <p className="text-sm text-slate-500">Create an organization first.</p>
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data }, role, showAccountCodes, { data: orgData }] = await Promise.all([
    supabase
      .from("accounts")
      .select("id, account_number, name, type, is_active, tax_line_id, property_id, description")
      .eq("organization_id", orgId)
      .order("account_number"),
    getCurrentUserRole(orgId),
    getUseAccountCodes(orgId),
    supabase.from("organizations").select("tax_form").eq("id", orgId).maybeSingle(),
  ]);

  const accounts = (data as AccountRow[] | null) ?? [];
  const userCanWrite = canWrite(role);
  const taxForm = (orgData as { tax_form: string } | null)?.tax_form ?? "none";

  const forms = TAX_FORM_LINES[taxForm] ?? [];
  const [{ data: taxLinesData }, { data: propertiesData }] = await Promise.all([
    forms.length === 0
      ? Promise.resolve({ data: null })
      : supabase.from("tax_lines").select("id, form, code, label").in("form", forms).order("sort_order"),
    forms.includes(PER_PROPERTY_FORM)
      ? supabase.from("properties").select("id, name").eq("organization_id", orgId).order("name")
      : Promise.resolve({ data: null }),
  ]);
  // A book with several forms names the form with each line.
  const taxLines = ((taxLinesData as TaxLineOption[] | null) ?? [])
    .sort((a, b) => forms.indexOf(a.form) - forms.indexOf(b.form))
    .map((t) => (forms.length > 1 ? { ...t, code: `${FORM_NAMES[t.form] ?? t.form} ${t.code}` } : t));
  const properties = (propertiesData as { id: string; name: string }[] | null) ?? [];
  const taxLineById = new Map(taxLines.map((t) => [t.id, t]));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader title="Chart of Accounts" description="Account list and new account form." />
        <div className="flex flex-wrap items-center gap-3">
          <DownloadButton
            href="/api/export/accounts"
            label="Export CSV"
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          />
          {userCanWrite && <CsvImportForm action="/api/import/accounts" label="Import CSV" />}
        </div>
      </div>

      {userCanWrite ? (
        <NewAccountForm
          organizationId={orgId}
          showAccountCodes={showAccountCodes}
          taxLines={taxLines}
        />
      ) : (
        <ReadOnlyNotice />
      )}

      {taxForm === "none" && (
        <p className="text-sm text-slate-500">
          Set a tax form in{" "}
          <a href="/settings" className="underline hover:text-slate-900">
            Settings
          </a>{" "}
          to tag accounts with tax lines and run the Tax Line Report.
        </p>
      )}

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              {showAccountCodes && <th className="px-5 py-3 font-medium">Number</th>}
              <th className="px-5 py-3 font-medium">Name</th>
              <th className="px-5 py-3 font-medium">Type</th>
              <th className="px-5 py-3 font-medium">Status</th>
              {taxForm !== "none" && <th className="px-5 py-3 font-medium">Tax Line</th>}
              {userCanWrite && <th className="px-5 py-3 font-medium">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {accounts.length === 0 ? (
              <tr>
                <td
                  colSpan={
                    (showAccountCodes ? 1 : 0) +
                    3 +
                    (taxForm !== "none" ? 1 : 0) +
                    (userCanWrite ? 1 : 0)
                  }
                  className="px-5 py-6 text-center text-slate-500"
                >
                  No accounts yet.
                </td>
              </tr>
            ) : (
              accounts.map((account) => (
                <tr key={account.id} className="border-b border-slate-100 last:border-0">
                  {showAccountCodes && (
                    <td className="px-5 py-3 text-slate-600">{account.account_number}</td>
                  )}
                  <td className="px-5 py-3 text-slate-900">
                    {/* Its ledger: every entry, with a running balance. */}
                    <Link href={`/reports/account/${account.id}?from=accounts`} className="hover:underline">
                      {account.name}
                    </Link>
                  </td>
                  <td className="px-5 py-3 capitalize text-slate-600">{account.type}</td>
                  <td className="px-5 py-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        account.is_active
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {account.is_active ? "active" : "inactive"}
                    </span>
                  </td>
                  {taxForm !== "none" && (
                    <td className="px-5 py-3">
                      {account.type === "revenue" || account.type === "expense" ? (
                        userCanWrite ? (
                          <TaxLineForm
                            key={`${account.tax_line_id ?? ""}:${account.property_id ?? ""}`}
                            account={account}
                            taxLines={taxLines}
                            properties={properties}
                          />
                        ) : (
                          <span className="text-slate-600">
                            {account.tax_line_id
                              ? `${taxLineById.get(account.tax_line_id)?.code ?? ""} — ${taxLineById.get(account.tax_line_id)?.label ?? ""}`
                              : "Unassigned"}
                          </span>
                        )
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  )}
                  {userCanWrite && (
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <EditAccountDialog account={account} showAccountCodes={showAccountCodes} />
                        <form action={toggleAccountActive}>
                          <input type="hidden" name="id" value={account.id} />
                          <input type="hidden" name="isActive" value={String(account.is_active)} />
                          <button
                            type="submit"
                            className="text-xs text-slate-500 hover:text-slate-900"
                          >
                            {account.is_active ? "Deactivate" : "Activate"}
                          </button>
                        </form>
                        <DeleteAccountDialog
                          accountId={account.id}
                          accountName={account.name}
                          isActive={account.is_active}
                        />
                      </div>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
