"use client";

import { useState, type ChangeEvent } from "react";
import { MAX_ATTACHMENT_BYTES } from "@/lib/attachments";

export interface AttachmentInfo {
  id: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
}

// Sends a file to /api/attachments for an entry; the saved row, or an error.
export async function uploadAttachment(entryId: string, file: File): Promise<AttachmentInfo> {
  if (file.size > MAX_ATTACHMENT_BYTES) throw new Error(`${file.name} is over 4 MB`);
  const body = new FormData();
  body.set("journal_entry_id", entryId);
  body.set("file", file);
  const res = await fetch("/api/attachments", { method: "POST", body });
  const json = (await res.json().catch(() => ({}))) as { attachment?: AttachmentInfo; error?: string };
  if (!res.ok || !json.attachment) throw new Error(json.error ?? "Couldn't attach the file");
  return json.attachment;
}

function size(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function Attachments({
  entryId,
  initial,
  canWrite,
}: {
  entryId: string;
  initial: AttachmentInfo[];
  canWrite: boolean;
}) {
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(e: ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    e.target.value = "";
    setError(null);
    setBusy(true);
    try {
      for (const file of files) {
        const saved = await uploadAttachment(entryId, file);
        setItems((prev) => [...prev, saved]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't attach the file");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    const res = await fetch(`/api/attachments/${id}`, { method: "DELETE" });
    if (res.ok) setItems((prev) => prev.filter((a) => a.id !== id));
    else setError("Couldn't remove the attachment");
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">Attachments</h2>
        {canWrite && (
          <label className="cursor-pointer text-sm font-medium text-slate-600 hover:text-slate-900">
            {busy ? "Attaching…" : "+ Attach a receipt or document"}
            <input
              type="file"
              multiple
              accept="application/pdf,image/*"
              onChange={add}
              disabled={busy}
              className="sr-only"
            />
          </label>
        )}
      </div>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">None. A PDF or photo up to 4 MB can be attached.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {items.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 text-sm">
              <a href={`/api/attachments/${a.id}`} target="_blank" rel="noreferrer" className="truncate text-slate-900 underline">
                {a.file_name}
              </a>
              <span className="flex shrink-0 items-center gap-3 text-xs text-slate-500">
                {size(a.size_bytes)}
                <a href={`/api/attachments/${a.id}?download`} className="hover:text-slate-900">
                  Download
                </a>
                {canWrite && (
                  <button type="button" onClick={() => remove(a.id)} className="hover:text-red-600">
                    Remove
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
