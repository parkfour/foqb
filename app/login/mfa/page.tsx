import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { verifyMfaChallenge } from "./actions";

export default async function MfaChallengePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!aal || aal.currentLevel === aal.nextLevel) {
    redirect("/");
  }

  const { data: factorsData } = await supabase.auth.mfa.listFactors();
  const factor = factorsData?.totp.find((f) => f.status === "verified");
  if (!factor) {
    redirect("/");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">Two-factor verification</h1>
        <p className="mt-1 text-sm text-slate-500">
          Enter the 6-digit code from your authenticator app.
        </p>
        <form action={verifyMfaChallenge} className="mt-4 flex flex-col gap-3">
          <input type="hidden" name="factorId" value={factor.id} />
          <input
            type="text"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            required
            maxLength={6}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm tracking-widest"
          />
          <button
            type="submit"
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Verify
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>
      </div>
    </div>
  );
}
