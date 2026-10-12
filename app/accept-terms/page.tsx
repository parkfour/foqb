import Link from "next/link";
import { redirect } from "next/navigation";
import { hasAcceptedCurrentPolicies, POLICY_VERSION } from "@/lib/legal/policy";
import { logout } from "@/app/logout/actions";
import { acceptPolicies } from "./actions";

// Shown to anyone signed in who hasn't accepted the current Terms of Service
// and Privacy Policy yet: members whose account an owner created, and every
// user after the policies change.
export default async function AcceptTermsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await hasAcceptedCurrentPolicies()) {
    redirect("/");
  }
  const { error } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">Review our terms</h1>
        <p className="mt-2 text-sm text-slate-600">
          Before you continue, please read and agree to our{" "}
          <Link href="/terms" target="_blank" className="underline">
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link href="/privacy" target="_blank" className="underline">
            Privacy Policy
          </Link>
          . They describe how we collect, use, store and delete your data, including bank data
          you choose to connect through Plaid.
        </p>
        <p className="mt-2 text-xs text-slate-500">Version: {POLICY_VERSION}</p>

        <form action={acceptPolicies} className="mt-4 flex flex-col gap-3">
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" name="accept" required className="mt-0.5" />
            <span>I agree to the Terms of Service and Privacy Policy.</span>
          </label>
          <button
            type="submit"
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Agree and continue
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>

        <form action={logout} className="mt-4">
          <button type="submit" className="text-sm text-slate-500 hover:text-slate-900">
            Sign out instead
          </button>
        </form>
      </div>
    </div>
  );
}
