import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { isSiteAdmin } from "@/lib/org/site-admin";
import { requireCurrentPolicyAcceptance } from "@/lib/legal/policy";
import { logout } from "@/app/logout/actions";

// Deliberately standalone, not nested under (dashboard)'s layout — a
// Site-Admin-only account (created with no org membership at all) would
// otherwise hit that layout's "you need an organization" assumptions.
export default async function SiteAdminLayout({ children }: { children: ReactNode }) {
  if (!(await isSiteAdmin())) {
    redirect("/");
  }
  await requireCurrentPolicyAcceptance();

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 md:px-6">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-slate-900">FOQB</span>
          <span className="rounded-full bg-slate-900 px-2.5 py-1 text-xs font-medium text-white">
            Site Admin
          </span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/" className="text-sm text-slate-600 hover:text-slate-900">
            Back to dashboard
          </Link>
          <form action={logout}>
            <button type="submit" className="text-sm text-slate-600 hover:text-slate-900">
              Log out
            </button>
          </form>
        </div>
      </header>
      <main className="px-4 py-6 md:px-8">{children}</main>
    </div>
  );
}
