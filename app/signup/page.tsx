import Link from "next/link";
import { signup } from "./actions";
import { getSiteSettings, SIGNUPS_CLOSED } from "@/lib/site/settings";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const { error, message } = await searchParams;
  const { signupsEnabled } = await getSiteSettings();

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">Create your FOQB account</h1>
        {!signupsEnabled ? (
          <p className="mt-4 text-sm text-slate-600">{SIGNUPS_CLOSED}</p>
        ) : (
        <form action={signup} className="mt-4 flex flex-col gap-3">
          <input
            type="email"
            name="email"
            placeholder="Email"
            required
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            type="password"
            name="password"
            placeholder="Password"
            required
            minLength={8}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <label className="flex items-start gap-2 text-xs text-slate-600">
            <input type="checkbox" name="acceptPolicies" required className="mt-0.5" />
            <span>
              I agree to the{" "}
              <Link href="/terms" target="_blank" className="underline">
                Terms of Service
              </Link>{" "}
              and{" "}
              <Link href="/privacy" target="_blank" className="underline">
                Privacy Policy
              </Link>
              .
            </span>
          </label>
          <button
            type="submit"
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Sign up
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {message && <p className="text-sm text-emerald-700">{message}</p>}
        </form>
        )}
        <p className="mt-4 text-sm text-slate-500">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-slate-900 underline">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
