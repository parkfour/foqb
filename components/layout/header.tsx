"use client";

import { ChevronDown, LogOut, UserCircle, Wifi, WifiOff } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useOnlineStatus } from "@/components/providers/online-status-provider";
import { logout } from "@/app/logout/actions";
import { switchOrganization } from "@/app/(dashboard)/actions";
import type { MemberRole, UserOrganization } from "@/lib/org/current";

interface HeaderProps {
  organizations: UserOrganization[];
  currentOrgId: string | null;
  role: MemberRole | null;
}

const NEW_ORG_OPTION = "__new__";

export function Header({ organizations, currentOrgId, role }: HeaderProps) {
  const isOnline = useOnlineStatus();
  const router = useRouter();
  const currentOrg = organizations.find((org) => org.id === currentOrgId);

  return (
    <header className="flex h-16 items-center justify-between print:hidden border-b border-slate-200 bg-white px-4 md:px-6">
      <div className="ml-12 flex items-center gap-2 md:ml-0">
        {organizations.length > 0 ? (
          <>
            {currentOrg?.logoDataUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- data: URI, not an optimizable asset
              <img
                src={currentOrg.logoDataUrl}
                alt=""
                className="h-6 w-6 rounded-md border border-slate-100 object-contain"
              />
            )}
            <form action={switchOrganization} className="relative">
              <select
                // Remounted when the book changes, so it shows the new one
                // after a switch that lands on another page (a drill-down).
                key={currentOrgId ?? ""}
                name="organizationId"
                defaultValue={currentOrgId ?? ""}
                onChange={(e) => {
                  if (e.currentTarget.value === NEW_ORG_OPTION) {
                    router.push("/organizations/new");
                    return;
                  }
                  e.currentTarget.form?.requestSubmit();
                }}
                aria-label="Switch organization"
                className="appearance-none rounded-md border border-slate-200 py-1.5 pl-3 pr-8 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                {organizations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}{org.workspace_type === "household" ? " (Household)" : ""}
                  </option>
                ))}
                <option value={NEW_ORG_OPTION}>+ Create or restore another organization</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            </form>
          </>
        ) : (
          <span className="text-sm font-medium text-slate-500">No organization</span>
        )}
        {role === "viewer" && (
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
            Read-only
          </span>
        )}
      </div>

      <div className="flex items-center gap-4">
        <span
          className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
            isOnline ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"
          }`}
        >
          {isOnline ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
          {isOnline ? "Online" : "Offline"}
        </span>

        <Link
          href="/settings#password"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-500 hover:bg-slate-50"
          aria-label="Your password and sign-in"
          title="Your password and sign-in"
        >
          <UserCircle className="h-5 w-5" />
        </Link>

        <form action={logout}>
          <button
            type="submit"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-500 hover:bg-slate-50"
            aria-label="Log out"
            title="Log out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </form>
      </div>
    </header>
  );
}
