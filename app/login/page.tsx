import Link from "next/link";
import { login } from "./actions";
import { getSiteSettings } from "@/lib/site/settings";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const { error, message } = await searchParams;
  const { signupsEnabled } = await getSiteSettings();

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">Log in to FOQB</h1>
        <form action={login} className="mt-4 flex flex-col gap-3">
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
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Log in
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {message && <p className="text-sm text-emerald-700">{message}</p>}
        </form>
        {/* A demo sends no email, so password reset can't work there. */}
        {process.env.DEMO_MODE !== "1" && (
          <p className="mt-4 text-sm text-slate-500">
            <Link href="/forgot-password" className="font-medium text-slate-900 underline">
              Forgot password?
            </Link>
          </p>
        )}
        {signupsEnabled && (
          <p className="mt-2 text-sm text-slate-500">
            No account?{" "}
            <Link href="/signup" className="font-medium text-slate-900 underline">
              Sign up
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
