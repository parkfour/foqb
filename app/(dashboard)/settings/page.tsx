import { PageHeader } from "@/components/ui/page-header";
import { ReadOnlyNotice } from "@/components/ui/read-only-notice";
import { DownloadButton } from "@/components/ui/download-button";
import { ConnectBankButton } from "@/components/settings/connect-bank-button";
import { ReconnectBankButton } from "@/components/settings/reconnect-bank-button";
import { CreateMemberForm } from "@/components/settings/create-member-form";
import { RegeneratePasswordButton } from "@/components/settings/regenerate-password-button";
import { MfaSettings } from "@/components/settings/mfa-settings";
import { ChangePasswordForm } from "@/components/settings/change-password-form";
import { createClient } from "@/lib/supabase/server";
import { canWrite, getCurrentOrgId, getCurrentUserRole, getUseAccountCodes } from "@/lib/org/current";
import { formatAccountLabel } from "@/lib/accounts/format";
import { getSiteSettings } from "@/lib/site/settings";
import { BANK_LINKING_OFF_ORG, BANK_LINKING_OFF_SITE } from "@/lib/plaid/bank-linking";
import { formatTimestamp, formatTimestampDate } from "@/lib/time/book-time";
import { getBookClock } from "@/lib/org/book-clock";
import { TimezoneSetting } from "@/components/settings/timezone-setting";
import { PluginSettingsSection } from "@/components/settings/plugin-settings-section";
import { PluginSlot } from "@/components/plugins/plugin-slot";
import { getAllOrgPluginConfigs, getPluginSettingDefinitions } from "@/lib/plugins/settings";
import { availablePlugins } from "@/plugins";
import type { OrgPluginConfig } from "@/lib/plugins/types";
import { isPluginEnabled } from "@/lib/plugins/loader";
import {
  disconnectEnrollment,
  removeMember,
  removeOrganizationLogo,
  setBankLinking,
  setOwnerRemovalSecret,
  updateMemberRole,
  setOrganizationCurrency,
  updateOrganizationSettings,
  uploadOrganizationLogo,
} from "./actions";

interface EnrollmentRow {
  id: string;
  institution_name: string | null;
  status: "active" | "expiring" | "error" | "disconnected";
  disconnect_reason: string | null;
  created_at: string;
  last_synced_at: string | null;
}

interface OrganizationRow {
  name: string;
  currency: string;
  period_lock_date: string | null;
  inventory_enabled: boolean;
  use_account_codes: boolean;
  bank_linking_enabled: boolean;
  tax_form: "none" | "schedule_c" | "corporate" | "individual";
  ar_account_id: string | null;
  ap_account_id: string | null;
  tax_payable_account_id: string | null;
  default_tax_rate: number | null;
  logo_data_url: string | null;
}

interface AccountOption {
  id: string;
  account_number: string;
  name: string;
}

interface MemberRow {
  id: string;
  user_id: string;
  email: string;
  role: "owner" | "accountant" | "viewer";
  has_logged_in: boolean;
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error: pageError } = await searchParams;
  const orgId = await getCurrentOrgId();
  const bookClock = await getBookClock(orgId);
  const { timeZone } = bookClock;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: factorsData } = await supabase.auth.mfa.listFactors();
  const mfaFactor = factorsData?.totp.find((f) => f.status === "verified") ?? null;

  if (!orgId) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Settings"
          description="Period locking, inventory tracking, and bank enrollment status."
        />
        {pageError && <p className="text-sm text-red-600">{pageError}</p>}
        <ChangePasswordForm />
        <MfaSettings factor={mfaFactor} />
        <p className="text-sm text-slate-500">Create an organization first.</p>
      </div>
    );
  }

  const [
    { data },
    { data: orgData },
    { data: assetAccounts },
    { data: liabilityAccounts },
    role,
    { data: memberData },
    showAccountCodes,
    { data: hasOwnerRemovalSecret },
    siteSettings,
    pluginConfigsRaw,
  ] = await Promise.all([
    supabase
      .from("enrollments")
      .select("id, institution_name, status, disconnect_reason, created_at, last_synced_at")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false }),
    supabase
      .from("organizations")
      .select(
        "name, currency, period_lock_date, inventory_enabled, use_account_codes, bank_linking_enabled, tax_form, ar_account_id, ap_account_id, tax_payable_account_id, default_tax_rate, logo_data_url",
      )
      .eq("id", orgId)
      .single(),
    supabase
      .from("accounts")
      .select("id, account_number, name")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .eq("type", "asset")
      .order("account_number"),
    supabase
      .from("accounts")
      .select("id, account_number, name")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .eq("type", "liability")
      .order("account_number"),
    getCurrentUserRole(orgId),
    supabase.rpc("get_org_members", { p_org_id: orgId }),
    getUseAccountCodes(orgId),
    supabase.rpc("has_owner_removal_secret", { p_org_id: orgId }),
    getSiteSettings(supabase),
    getAllOrgPluginConfigs(supabase, orgId).catch(() => ({})),
  ]);

  const pluginConfigs: Record<string, OrgPluginConfig> = pluginConfigsRaw;
  const instancePlugins = availablePlugins.filter((p) =>
    isPluginEnabled(p.manifest.id, p.manifest.enabledByDefault),
  );
  const pluginsData = instancePlugins.map((p) => {
    const cfg = pluginConfigs[p.manifest.id];
    return {
      id: p.manifest.id,
      name: p.manifest.name,
      version: p.manifest.version,
      description: p.manifest.description,
      enabled: cfg?.enabled ?? (p.manifest.enabledByDefault ?? true),
      settingsSchema: getPluginSettingDefinitions(p),
      currentSettings: cfg?.settings ?? {},
    };
  });

  const enrollments = (data as EnrollmentRow[] | null) ?? [];
  const organization = orgData as OrganizationRow | null;
  const arOptions = (assetAccounts as AccountOption[] | null) ?? [];
  const apOptions = (liabilityAccounts as AccountOption[] | null) ?? [];
  const members = (memberData as MemberRow[] | null) ?? [];
  const userCanWrite = canWrite(role);
  const isOwner = role === "owner";
  const { count: entryCount } = await supabase
    .from("journal_entries")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId);
  const { count: feedCount } = await supabase
    .from("bank_transactions")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId);
  const bookHasEntries = (entryCount ?? 0) + (feedCount ?? 0) > 0;
  const ownerCount = members.filter((m) => m.role === "owner").length;
  const orgAllowsBanks = organization?.bank_linking_enabled ?? true;
  const bankLinkingBlocked = !siteSettings.bankLinkingEnabled
    ? BANK_LINKING_OFF_SITE
    : !orgAllowsBanks
      ? BANK_LINKING_OFF_ORG
      : null;
  const canLinkBanks = userCanWrite && !!mfaFactor && !bankLinkingBlocked;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Settings"
        description="Period locking, inventory tracking, and bank enrollment status."
      />

      {pageError && <p className="text-sm text-red-600">{pageError}</p>}

      <ChangePasswordForm />

      <MfaSettings factor={mfaFactor} />

      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Bank Connections</h2>
        {isOwner && (
          <form action={setBankLinking} className="mb-3 flex items-center gap-3">
            <input type="hidden" name="organizationId" value={orgId} />
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                name="bankLinkingEnabled"
                defaultChecked={orgAllowsBanks}
                className="h-4 w-4 rounded border-slate-300"
              />
              Allow connecting banks
            </label>
            <button type="submit" className="text-sm text-slate-500 hover:text-slate-900">
              Save
            </button>
          </form>
        )}
        {userCanWrite &&
          (bankLinkingBlocked ? (
            <p className="text-sm text-slate-500">{bankLinkingBlocked}</p>
          ) : mfaFactor ? (
            <ConnectBankButton
              organizationId={orgId}
              linkableAccounts={[...arOptions, ...apOptions].map((a) => ({ id: a.id, label: a.name }))}
            />
          ) : (
            <p className="text-sm text-amber-700">
              Two-factor authentication is required to connect or reconnect a bank. Set it up under
              Two-Factor Authentication above.
            </p>
          ))}

        <div className="mt-4 flex flex-col gap-2">
          {enrollments.length === 0 ? (
            <p className="text-sm text-slate-500">No banks connected yet.</p>
          ) : (
            enrollments.map((enrollment) => (
              <div
                key={enrollment.id}
                className="flex items-center justify-between rounded-md border border-slate-100 px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    {enrollment.institution_name ?? "Unknown institution"}
                  </p>
                  <p className="text-xs text-slate-500">
                    Connected {formatTimestampDate(enrollment.created_at, timeZone)}
                    {enrollment.last_synced_at &&
                      ` · Last update from the bank ${formatTimestamp(enrollment.last_synced_at, timeZone)}`}
                  </p>
                  {enrollment.status !== "active" && enrollment.disconnect_reason && (
                    <p className="text-xs text-slate-500">{enrollment.disconnect_reason}</p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      enrollment.status === "active"
                        ? "bg-emerald-100 text-emerald-800"
                        : enrollment.status === "error"
                          ? "bg-red-100 text-red-800"
                          : enrollment.status === "expiring"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {enrollment.status === "error" ? "needs reconnecting" : enrollment.status}
                  </span>
                  {canLinkBanks &&
                    (enrollment.status === "error" || enrollment.status === "expiring") && (
                      <ReconnectBankButton enrollmentId={enrollment.id} />
                    )}
                  {canLinkBanks && enrollment.status === "active" && (
                    <ReconnectBankButton enrollmentId={enrollment.id} addAccounts />
                  )}
                  {userCanWrite && enrollment.status !== "disconnected" && (
                    <form action={disconnectEnrollment}>
                      <input type="hidden" name="id" value={enrollment.id} />
                      <button type="submit" className="text-sm text-slate-400 hover:text-red-600">
                        Disconnect
                      </button>
                    </form>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Members</h2>

        <div className="flex flex-col gap-2">
          {members.map((member) => {
            // With 2 or fewer owners left, removing/demoting one of them
            // would leave the org at its last or second-to-last owner —
            // the DB trigger enforces this regardless, but the secret
            // field only needs to show up where it could actually matter.
            const isGuardedOwner = member.role === "owner" && ownerCount <= 2;

            return (
              <div
                key={member.id}
                className="flex flex-col gap-2 rounded-md border border-slate-100 px-3 py-2"
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm text-slate-900">
                    {member.email}
                    {member.user_id === user?.id && (
                      <span className="ml-2 text-xs text-slate-400">(you)</span>
                    )}
                    {!member.has_logged_in && (
                      <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                        not yet logged in
                      </span>
                    )}
                  </p>
                  <div className="flex items-center gap-3">
                    {!member.has_logged_in && isOwner && (
                      <RegeneratePasswordButton
                        organizationId={orgId}
                        userId={member.user_id}
                        email={member.email}
                      />
                    )}
                    {isOwner ? (
                      <form action={updateMemberRole} className="flex items-center gap-2">
                        <input type="hidden" name="id" value={member.id} />
                        {isGuardedOwner && (
                          <input
                            type="password"
                            name="secret"
                            placeholder="Owner-removal secret"
                            className="w-36 rounded-md border border-slate-300 px-2 py-1 text-xs"
                          />
                        )}
                        <select
                          name="role"
                          defaultValue={member.role}
                          className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                        >
                          <option value="owner">Owner</option>
                          <option value="accountant">Accountant</option>
                          <option value="viewer">Viewer</option>
                        </select>
                        <button type="submit" className="text-xs text-slate-500 hover:text-slate-900">
                          Update
                        </button>
                      </form>
                    ) : (
                      <span className="text-xs capitalize text-slate-500">{member.role}</span>
                    )}
                    {isOwner && (
                      <form action={removeMember} className="flex items-center gap-2">
                        <input type="hidden" name="id" value={member.id} />
                        {isGuardedOwner && (
                          <input
                            type="password"
                            name="secret"
                            placeholder="Owner-removal secret"
                            className="w-36 rounded-md border border-slate-300 px-2 py-1 text-xs"
                          />
                        )}
                        <button type="submit" className="text-sm text-slate-400 hover:text-red-600">
                          Remove
                        </button>
                      </form>
                    )}
                  </div>
                </div>
                {isGuardedOwner && (
                  <p className="text-xs text-amber-700">
                    This is one of {ownerCount} remaining owner{ownerCount === 1 ? "" : "s"} —
                    removing or demoting them requires the organization&apos;s owner-removal
                    secret.
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {isOwner ? (
          <CreateMemberForm organizationId={orgId} />
        ) : (
          userCanWrite && (
            <p className="mt-4 text-xs text-slate-500">Only an owner can add new members.</p>
          )
        )}
      </div>

      {isOwner && (
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-1 text-sm font-semibold text-slate-900">Owner-Removal Secret</h2>
          {hasOwnerRemovalSecret ? (
            <p className="text-sm text-emerald-700">Set</p>
          ) : (
            <>
              <p className="text-xs text-slate-500">
                Not set — this organization&apos;s last or second-to-last owner can&apos;t be
                removed or demoted until one is. Settable once; store it somewhere safe.
              </p>
              <form action={setOwnerRemovalSecret} className="mt-3 flex flex-wrap gap-2">
                <input type="hidden" name="organizationId" value={orgId} />
                <input
                  type="password"
                  name="secret"
                  placeholder="At least 8 characters"
                  minLength={8}
                  required
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
                <input
                  type="password"
                  name="secretConfirm"
                  placeholder="Confirm secret"
                  minLength={8}
                  required
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
                <button
                  type="submit"
                  className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Set secret
                </button>
              </form>
            </>
          )}
        </div>
      )}

      {isOwner && (
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Organization Logo</h2>
          <p className="text-xs text-slate-500">
            Shown in the sidebar, the organization switcher, and on invoices.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            {organization?.logo_data_url && (
              <div className="flex items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- data: URI, not an optimizable asset */}
                <img
                  src={organization.logo_data_url}
                  alt=""
                  className="h-16 w-16 rounded-md border border-slate-200 object-contain"
                />
                <form action={removeOrganizationLogo}>
                  <input type="hidden" name="organizationId" value={orgId} />
                  <button type="submit" className="text-sm text-slate-400 hover:text-red-600">
                    Remove
                  </button>
                </form>
              </div>
            )}
            <form action={uploadOrganizationLogo} className="flex items-center gap-2">
              <input type="hidden" name="organizationId" value={orgId} />
              <input
                type="file"
                name="file"
                accept="image/*"
                required
                className="text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
              />
              <button
                type="submit"
                className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                {organization?.logo_data_url ? "Replace" : "Upload"}
              </button>
            </form>
          </div>
        </div>
      )}

      {isOwner && (
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Backup</h2>
          <p className="mt-1 text-xs text-slate-500">
            A full export of everything in this organization — accounts, journal entries,
            invoices, bills, customers, vendors, and more — as one JSON file.
          </p>
          <DownloadButton
            href="/api/export/organization"
            label="Download full backup"
            className="mt-3 inline-block rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          />
        </div>
      )}

      <PluginSettingsSection
        organizationId={orgId}
        isOwner={isOwner}
        plugins={pluginsData}
      />

      <PluginSlot name="settings.sections" context={{ organizationId: orgId }} className="flex flex-col gap-6" />

      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Time</h2>
        {/* Keyed so it starts over from the saved value after a change. */}
        <TimezoneSetting
          key={bookClock.timeZone}
          organizationId={orgId}
          timeZone={bookClock.timeZone}
          usesInstanceDefault={bookClock.usesInstanceDefault}
          isOwner={isOwner}
        />
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Currency</h2>
        <p className="mb-2 text-xs text-slate-500">
          Every amount in this book is in its currency. It can be changed only while nothing has been booked or
          imported; nothing is converted between books.
        </p>
        {isOwner && !bookHasEntries ? (
          <form action={setOrganizationCurrency} className="flex items-center gap-2">
            <input type="hidden" name="organizationId" value={orgId} />
            <select
              name="currency"
              defaultValue={organization?.currency ?? "USD"}
              aria-label="Currency"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              {Intl.supportedValuesOf("currency").map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Save
            </button>
          </form>
        ) : (
          <p className="text-sm font-medium text-slate-700">{organization?.currency ?? "USD"}</p>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Organization Settings</h2>
        {!userCanWrite ? (
          <ReadOnlyNotice />
        ) : (
        <form action={updateOrganizationSettings} className="flex flex-col gap-4">
          <input type="hidden" name="organizationId" value={orgId} />

          <div className="flex flex-col gap-1">
            <label htmlFor="periodLockDate" className="text-sm font-medium text-slate-700">
              Period lock date
            </label>
            <p className="text-xs text-slate-500">
              Entries dated on or before this date can no longer be created, edited, voided, or
              deleted.
            </p>
            <input
              type="date"
              id="periodLockDate"
              name="periodLockDate"
              defaultValue={organization?.period_lock_date ?? ""}
              className="w-fit rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              name="inventoryEnabled"
              defaultChecked={organization?.inventory_enabled ?? false}
              className="h-4 w-4 rounded border-slate-300"
            />
            Enable inventory tracking
          </label>

          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                name="useAccountCodes"
                defaultChecked={organization?.use_account_codes ?? true}
                className="h-4 w-4 rounded border-slate-300"
              />
              Use account numbers
            </label>
            <p className="text-xs text-slate-500">
              Shows account numbers throughout the app. Turning this off hides them everywhere
              (Chart of Accounts, reports, dropdowns) — new accounts still get one automatically
              behind the scenes.
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="taxForm" className="text-sm font-medium text-slate-700">
              Tax form
            </label>
            <p className="text-xs text-slate-500">
              Tags Chart of Accounts entries against standard tax return lines, so the Tax Line
              Report can total income/expenses per line for a period. Choose which form&apos;s
              lines to use.
            </p>
            <select
              id="taxForm"
              name="taxForm"
              defaultValue={organization?.tax_form ?? "none"}
              className="w-fit rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="none">Not set</option>
              <option value="schedule_c">Schedule C (Form 1040, sole proprietor)</option>
              <option value="corporate">Form 1120 / 1120-S (corporate)</option>
              <option value="individual">Form 1040 with Schedules 1, B, C, D and E (individual)</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="arAccountId" className="text-sm font-medium text-slate-700">
              Accounts Receivable control account
            </label>
            <p className="text-xs text-slate-500">
              Used when posting invoices and customer payments. Leave unset to auto-detect an
              asset account named &ldquo;...receivable&rdquo;.
            </p>
            <select
              id="arAccountId"
              name="arAccountId"
              defaultValue={organization?.ar_account_id ?? ""}
              className="w-fit rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Auto-detect</option>
              {arOptions.map((account) => (
                <option key={account.id} value={account.id}>
                  {formatAccountLabel(account, showAccountCodes)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="apAccountId" className="text-sm font-medium text-slate-700">
              Accounts Payable control account
            </label>
            <p className="text-xs text-slate-500">
              Used when posting vendor bills and payments. Leave unset to auto-detect a liability
              account named &ldquo;...payable&rdquo;.
            </p>
            <select
              id="apAccountId"
              name="apAccountId"
              defaultValue={organization?.ap_account_id ?? ""}
              className="w-fit rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Auto-detect</option>
              {apOptions.map((account) => (
                <option key={account.id} value={account.id}>
                  {formatAccountLabel(account, showAccountCodes)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="taxPayableAccountId" className="text-sm font-medium text-slate-700">
              Sales Tax Payable control account
            </label>
            <p className="text-xs text-slate-500">
              Used when an invoice charges sales tax. Leave unset to auto-detect a liability
              account named &ldquo;...tax...&rdquo;.
            </p>
            <select
              id="taxPayableAccountId"
              name="taxPayableAccountId"
              defaultValue={organization?.tax_payable_account_id ?? ""}
              className="w-fit rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Auto-detect</option>
              {apOptions.map((account) => (
                <option key={account.id} value={account.id}>
                  {formatAccountLabel(account, showAccountCodes)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="defaultTaxRate" className="text-sm font-medium text-slate-700">
              Default sales tax rate (%)
            </label>
            <p className="text-xs text-slate-500">Prefills the tax rate on new invoices.</p>
            <input
              type="number"
              step="0.01"
              min="0"
              id="defaultTaxRate"
              name="defaultTaxRate"
              defaultValue={organization?.default_tax_rate ?? ""}
              className="w-32 rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          <button
            type="submit"
            className="w-fit rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Save settings
          </button>
        </form>
        )}
      </div>
    </div>
  );
}
