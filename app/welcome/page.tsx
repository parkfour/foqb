import Image from "next/image";
import Link from "next/link";
import { getOperatorInfo } from "@/lib/legal/operator";
import { getSiteSettings } from "@/lib/site/settings";
import { getSourceCodeUrl } from "@/lib/legal/source-code";

export default async function WelcomePage() {
  const operator = getOperatorInfo();
  const { signupsEnabled } = await getSiteSettings();
  const sourceCodeUrl = getSourceCodeUrl();

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex items-center gap-2">
          <Image src="/icon.svg" alt="" width={32} height={32} unoptimized className="rounded-md" />
          <span className="text-lg font-semibold text-slate-900">FOQB</span>
        </div>
        <p className="mt-1 text-sm text-slate-500">Free, Open, Quality Bookkeeping</p>

        <p className="mt-4 text-sm text-slate-700">
          A multi-tenant, double-entry accounting app: chart of accounts, live bank sync via
          Plaid, invoicing and bill payment, financial reports, and a full audit log. Free to run
          yourself — open source (AGPL-3.0), no per-seat pricing.
          {sourceCodeUrl && (
            <>
              {" "}
              <a href={sourceCodeUrl} className="underline">
                Get the source code
              </a>
              .
            </>
          )}
        </p>

        <ul className="mt-4 list-disc pl-5 text-sm text-slate-600">
          <li>Double-entry bookkeeping with real balance-sheet and P&amp;L reports</li>
          <li>Bank transaction sync and reconciliation via Plaid</li>
          <li>Invoicing, bill payment, and AR/AP aging</li>
          <li>Per-organization data isolation, role-based access, and an audit log</li>
        </ul>

        <div className="mt-6 flex gap-3">
          <Link
            href="/login"
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Log in
          </Link>
          {signupsEnabled && (
            <Link
              href="/signup"
              className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Sign up
            </Link>
          )}
        </div>

        {operator && (
          <div className="mt-6 border-t border-slate-100 pt-4 text-xs text-slate-500">
            <p>
              This instance is operated by {operator.name}. See our{" "}
              <Link href="/security" className="underline">
                Security
              </Link>
              ,{" "}
              <Link href="/privacy" className="underline">
                Privacy
              </Link>
              , and{" "}
              <Link href="/terms" className="underline">
                Terms
              </Link>{" "}
              pages.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
