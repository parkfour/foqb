"use client";

import { useActionState, useState, useTransition } from "react";
import {
  enrollMfaFactor,
  unenrollMfaFactor,
  verifyMfaEnrollment,
  type MfaVerifyState,
} from "@/app/(dashboard)/settings/mfa-actions";

const initialVerifyState: MfaVerifyState = { error: null };

interface PendingEnrollment {
  factorId: string;
  qrCode: string;
  secret: string;
}

export function MfaSettings({ factor }: { factor: { id: string } | null }) {
  const [enrollment, setEnrollment] = useState<PendingEnrollment | null>(null);
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [isEnrolling, startEnrolling] = useTransition();
  const [verifyState, verifyAction, isVerifying] = useActionState(
    verifyMfaEnrollment,
    initialVerifyState,
  );

  if (factor) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-1 text-sm font-semibold text-slate-900">Two-Factor Authentication</h2>
        <p className="text-sm text-emerald-700">Enabled</p>
        <form action={unenrollMfaFactor} className="mt-3">
          <input type="hidden" name="factorId" value={factor.id} />
          <button type="submit" className="text-sm text-slate-400 hover:text-red-600">
            Disable
          </button>
        </form>
      </div>
    );
  }

  if (enrollment) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-1 text-sm font-semibold text-slate-900">Two-Factor Authentication</h2>
        <p className="mt-1 text-xs text-slate-500">
          Scan this QR code with an authenticator app (1Password, Authy, Google Authenticator),
          then enter the 6-digit code it shows.
        </p>
        {/* eslint-disable-next-line @next/next/no-img-element -- data: URI SVG from Supabase, not an optimizable asset */}
        <img
          src={enrollment.qrCode}
          alt="Two-factor authentication QR code"
          className="mt-3 h-40 w-40"
        />
        <p className="mt-2 break-all font-mono text-xs text-slate-400">{enrollment.secret}</p>
        <form action={verifyAction} className="mt-3 flex flex-col gap-2">
          <input type="hidden" name="factorId" value={enrollment.factorId} />
          <input
            type="text"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            required
            maxLength={6}
            className="w-32 rounded-md border border-slate-300 px-3 py-2 text-sm tracking-widest"
          />
          <button
            type="submit"
            disabled={isVerifying}
            className="w-fit rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {isVerifying ? "Verifying…" : "Verify and enable"}
          </button>
          {verifyState.error && <p className="text-xs text-red-600">{verifyState.error}</p>}
        </form>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-1 text-sm font-semibold text-slate-900">Two-Factor Authentication</h2>
      <p className="text-xs text-slate-500">Not enabled.</p>
      <button
        type="button"
        disabled={isEnrolling}
        onClick={() =>
          startEnrolling(async () => {
            setEnrollError(null);
            const result = await enrollMfaFactor();
            if (!result.factorId || !result.qrCode || !result.secret) {
              setEnrollError(result.error ?? "Failed to start enrollment");
              return;
            }
            setEnrollment({
              factorId: result.factorId,
              qrCode: result.qrCode,
              secret: result.secret,
            });
          })
        }
        className="mt-3 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        {isEnrolling ? "Starting…" : "Set up two-factor authentication"}
      </button>
      {enrollError && <p className="mt-2 text-xs text-red-600">{enrollError}</p>}
    </div>
  );
}
