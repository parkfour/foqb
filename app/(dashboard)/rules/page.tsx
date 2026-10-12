import { PageHeader } from "@/components/ui/page-header";
import { ReadOnlyNotice } from "@/components/ui/read-only-notice";
import { NewRuleForm } from "@/components/rules/new-rule-form";
import { createClient } from "@/lib/supabase/server";
import { canWrite, getCurrentOrgId, getCurrentUserRole, getUseAccountCodes } from "@/lib/org/current";
import { formatAccountLabel } from "@/lib/accounts/format";
import { toggleRuleActive, deleteRule } from "./actions";

interface AccountOption {
  id: string;
  account_number: string;
  name: string;
}

interface RuleRow {
  id: string;
  rule_name: string;
  match_type: string;
  match_text: string;
  transaction_type: string;
  min_amount: number | null;
  max_amount: number | null;
  priority: number;
  is_active: boolean;
  accounts: { account_number: string; name: string } | null;
}

export default async function RulesPage() {
  const orgId = await getCurrentOrgId();

  if (!orgId) {
    return (
      <div>
        <PageHeader
          title="Rules"
          description="Auto-categorization rules for imported bank transactions."
        />
        <p className="text-sm text-slate-500">Create an organization first.</p>
      </div>
    );
  }

  const supabase = await createClient();

  const [{ data: accountsData }, { data: rulesData }, role, showAccountCodes] = await Promise.all([
    supabase
      .from("accounts")
      .select("id, account_number, name")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .order("account_number"),
    supabase
      .from("categorization_rules")
      .select(
        "id, rule_name, match_type, match_text, transaction_type, min_amount, max_amount, priority, is_active, accounts(account_number, name)",
      )
      .eq("organization_id", orgId)
      .order("priority", { ascending: true }),
    getCurrentUserRole(orgId),
    getUseAccountCodes(orgId),
  ]);

  const accounts = (accountsData as AccountOption[] | null) ?? [];
  const rules = (rulesData as unknown as RuleRow[] | null) ?? [];
  const userCanWrite = canWrite(role);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Rules"
        description="Auto-categorization rules for imported bank transactions."
      />

      {userCanWrite ? (
        <NewRuleForm organizationId={orgId} accounts={accounts} showAccountCodes={showAccountCodes} />
      ) : (
        <ReadOnlyNotice />
      )}

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">Priority</th>
                <th className="px-5 py-3 font-medium">Rule</th>
                <th className="px-5 py-3 font-medium">Match</th>
                <th className="px-5 py-3 font-medium">Type</th>
                <th className="px-5 py-3 font-medium">Amount range</th>
                <th className="px-5 py-3 font-medium">Target account</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rules.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-6 text-center text-slate-500">
                    No rules yet.
                  </td>
                </tr>
              ) : (
                rules.map((rule) => (
                  <tr key={rule.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-5 py-3 text-slate-600">{rule.priority}</td>
                    <td className="px-5 py-3 text-slate-900">{rule.rule_name}</td>
                    <td className="px-5 py-3 text-slate-600">
                      {rule.match_type}: &ldquo;{rule.match_text}&rdquo;
                    </td>
                    <td className="px-5 py-3 text-slate-600">{rule.transaction_type}</td>
                    <td className="px-5 py-3 text-slate-600">
                      {rule.min_amount ?? "—"} – {rule.max_amount ?? "—"}
                    </td>
                    <td className="px-5 py-3 text-slate-600">
                      {rule.accounts ? formatAccountLabel(rule.accounts, showAccountCodes) : "—"}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                          rule.is_active
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {rule.is_active ? "active" : "inactive"}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      {userCanWrite && (
                        <div className="flex items-center justify-end gap-3">
                          <form action={toggleRuleActive}>
                            <input type="hidden" name="id" value={rule.id} />
                            <input
                              type="hidden"
                              name="isActive"
                              value={rule.is_active ? "true" : "false"}
                            />
                            <button
                              type="submit"
                              className="text-sm text-slate-400 hover:text-slate-900"
                            >
                              {rule.is_active ? "Disable" : "Enable"}
                            </button>
                          </form>
                          <form action={deleteRule}>
                            <input type="hidden" name="id" value={rule.id} />
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
