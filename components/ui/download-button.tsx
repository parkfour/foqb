"use client";

import { useState } from "react";
import { shareOrDownloadFile } from "@/lib/pwa/share-or-download";

function filenameFromContentDisposition(response: Response, fallback: string): string {
  const header = response.headers.get("Content-Disposition");
  const match = header?.match(/filename="?([^"]+)"?/);
  return match?.[1] ?? fallback;
}

interface DownloadButtonProps {
  href: string;
  label: string;
  className?: string;
  shareTitle?: string;
}

// Fetches the file itself (rather than a plain <a href> navigation) so it
// can offer the native share sheet on a mobile PWA before falling back to
// an ordinary download — see lib/pwa/share-or-download.ts.
export function DownloadButton({ href, label, className, shareTitle }: DownloadButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(href);
      if (!response.ok) {
        throw new Error(`Download failed (${response.status})`);
      }

      const blob = await response.blob();
      const filename = filenameFromContentDisposition(response, "download");
      const file = new File([blob], filename, { type: blob.type });

      await shareOrDownloadFile(file, { title: shareTitle ?? filename });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Download failed");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button type="button" onClick={handleClick} disabled={isLoading} className={className}>
        {isLoading ? "Preparing…" : label}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </span>
  );
}
