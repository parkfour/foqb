"use client";

import { useState, type FormEvent } from "react";
import { Upload } from "lucide-react";

interface ImportResult {
  success: boolean;
  dryRun?: boolean;
  imported: number;
  // Already imported before, and left alone (journal entries).
  skipped?: number;
  errors: string[];
}

interface CsvImportFormProps {
  action: string;
  label: string;
}

async function submitCsv(action: string, file: File, dryRun: boolean): Promise<ImportResult> {
  const formData = new FormData();
  formData.set("file", file);
  formData.set("dryRun", String(dryRun));

  const response = await fetch(action, { method: "POST", body: formData });
  return (await response.json()) as ImportResult;
}

export function CsvImportForm({ action, label }: CsvImportFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function handlePreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fileInput = event.currentTarget.elements.namedItem("file") as HTMLInputElement | null;
    const file = fileInput?.files?.[0];

    if (!file || file.size === 0) {
      return;
    }

    setIsSubmitting(true);
    setResult(null);
    setPreview(null);

    try {
      const data = await submitCsv(action, file, true);
      setPendingFile(file);
      setPreview(data);
    } catch {
      setResult({ success: false, imported: 0, errors: ["Preview failed"] });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleConfirm() {
    if (!pendingFile) return;

    setIsSubmitting(true);

    try {
      const data = await submitCsv(action, pendingFile, false);
      setResult(data);
    } catch {
      setResult({ success: false, imported: 0, errors: ["Import failed"] });
    } finally {
      setPreview(null);
      setPendingFile(null);
      setIsSubmitting(false);
    }
  }

  function handleCancel() {
    setPreview(null);
    setPendingFile(null);
  }

  return (
    <div className="flex flex-col gap-2">
      {!preview && (
        <form onSubmit={handlePreview} className="flex items-center gap-2">
          <input
            type="file"
            name="file"
            accept=".csv,text/csv"
            required
            className="text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
          />
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            <Upload className="h-4 w-4" />
            {isSubmitting ? "Checking…" : label}
          </button>
        </form>
      )}

      {preview && (
        <div className="flex flex-col gap-2 rounded-md border border-slate-200 bg-slate-50 p-3">
          <p className="text-sm text-slate-700">
            Preview: would import <strong>{preview.imported}</strong> row
            {preview.imported === 1 ? "" : "s"}.
            {!!preview.skipped && ` ${preview.skipped} already imported, skipped.`}
            {preview.errors.length > 0 && (
              <span className="text-amber-700">
                {" "}
                {preview.errors.length} error(s): {preview.errors.slice(0, 3).join("; ")}
              </span>
            )}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleConfirm}
              disabled={isSubmitting || preview.imported === 0}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {isSubmitting ? "Importing…" : `Confirm Import (${preview.imported})`}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              disabled={isSubmitting}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {result && (
        <p
          className={`text-sm ${result.errors.length > 0 ? "text-amber-700" : "text-emerald-700"}`}
        >
          Imported {result.imported} row{result.imported === 1 ? "" : "s"}.
          {!!result.skipped && ` ${result.skipped} already imported, skipped.`}
          {result.errors.length > 0 &&
            ` ${result.errors.length} error(s): ${result.errors.slice(0, 3).join("; ")}`}
        </p>
      )}
    </div>
  );
}
