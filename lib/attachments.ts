// What a journal entry's attachment may be (supabase/migrations/
// 20260101000074_attachments.sql has the same limits).

export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;

// Each allowed type and how its file starts. The type comes from the
// bytes, not from what the browser claimed, so nothing but these is ever
// stored or served back.
const SIGNATURES: { type: string; matches: (b: Uint8Array) => boolean }[] = [
  { type: "application/pdf", matches: (b) => ascii(b, 0, "%PDF-") },
  { type: "image/jpeg", matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: "image/png", matches: (b) => b[0] === 0x89 && ascii(b, 1, "PNG") },
  { type: "image/gif", matches: (b) => ascii(b, 0, "GIF8") },
  { type: "image/webp", matches: (b) => ascii(b, 0, "RIFF") && ascii(b, 8, "WEBP") },
  { type: "image/heic", matches: (b) => ascii(b, 4, "ftyp") && ["heic", "heix", "mif1", "msf1"].some((brand) => ascii(b, 8, brand)) },
];

function ascii(bytes: Uint8Array, at: number, text: string): boolean {
  for (let i = 0; i < text.length; i++) if (bytes[at + i] !== text.charCodeAt(i)) return false;
  return true;
}

export function detectAttachmentType(bytes: Uint8Array): string | null {
  return SIGNATURES.find((s) => s.matches(bytes))?.type ?? null;
}

// A file name safe to keep and to send back in Content-Disposition.
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f"]/g, "").trim().slice(0, 255);
  return cleaned || "attachment";
}

// bytea in and out of PostgREST is hex text: "\x" then two digits a byte.
export function toByteaHex(bytes: Uint8Array): string {
  return "\\x" + Buffer.from(bytes).toString("hex");
}

export function fromByteaHex(value: string): Buffer {
  return Buffer.from(value.startsWith("\\x") ? value.slice(2) : value, "hex");
}
