"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

interface RestoreResult {
  success?: boolean;
  organizationId?: string;
  error?: string;
}

export function RestoreOrgForm() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fileInput = event.currentTarget.elements.namedItem("file") as HTMLInputElement | null;
    const file = fileInput?.files?.[0];

    if (!file || file.size === 0) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.set("file", file);
      const response = await fetch("/api/import/organization", { method: "POST", body: formData });
      const data = (await response.json()) as RestoreResult;

      if (!response.ok) {
        throw new Error(data.error ?? "Restore failed");
      }

      // The route handler doesn't auto-revalidate the server-rendered
      // dashboard, same reason ConnectBankButton calls this too.
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Restore failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mx-auto mt-4 max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">...or restore from a backup</h2>
      <p className="mt-1 text-sm text-slate-500">
        Upload a backup file downloaded from Settings. This creates a new organization from it —
        it never modifies an existing one.
      </p>
      <form onSubmit={handleSubmit} className="mt-4 flex items-center gap-2">
        <input
          type="file"
          name="file"
          accept=".json,application/json"
          required
          className="text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
        />
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {isSubmitting ? "Restoring…" : "Restore"}
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
