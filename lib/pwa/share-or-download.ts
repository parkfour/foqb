export interface ShareOptions {
  title?: string;
  text?: string;
}

// Tries the native share sheet first — on a mobile PWA, a plain download
// often just opens the file in a new tab with no obvious way to save it,
// while the share sheet lets you save to Files, AirDrop, email it, etc.
// Falls back to a normal browser download when Web Share isn't available or
// doesn't support files (most desktop browsers today).
export async function shareOrDownloadFile(file: File, options: ShareOptions = {}): Promise<void> {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: options.title, text: options.text });
      return;
    } catch (err) {
      // A user cancelling the native share sheet also lands here (AbortError) —
      // that's not a real failure, so don't treat it as one.
      if (err instanceof Error && err.name === "AbortError") return;
      throw err;
    }
  }

  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  // Some browsers only honor a download click on an element that's
  // actually in the document — a detached <a> silently no-ops.
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
