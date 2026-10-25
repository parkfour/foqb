import { describe, expect, it } from "vitest";
import { cleanFileName, detectAttachmentType, fromByteaHex, toByteaHex } from "@/lib/attachments";

const bytes = (...b: number[]) => new Uint8Array(b);
const text = (s: string) => new TextEncoder().encode(s);

describe("attachments", () => {
  it("tells the type from the file's first bytes, not its name", () => {
    expect(detectAttachmentType(text("%PDF-1.7"))).toBe("application/pdf");
    expect(detectAttachmentType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(detectAttachmentType(bytes(0x89, 0x50, 0x4e, 0x47))).toBe("image/png");
    expect(detectAttachmentType(text("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(detectAttachmentType(text("\0\0\0\x18ftypheic"))).toBe("image/heic");
    expect(detectAttachmentType(text("<html><script>"))).toBeNull();
    expect(detectAttachmentType(text("<svg xmlns="))).toBeNull();
  });

  it("keeps only a plain file name", () => {
    expect(cleanFileName("C:\\Users\\me\\receipt.pdf")).toBe("receipt.pdf");
    expect(cleanFileName('../a"b\n.png')).toBe("ab.png");
    expect(cleanFileName("")).toBe("attachment");
  });

  it("round-trips bytes through PostgREST's bytea hex", () => {
    const hex = toByteaHex(bytes(0, 1, 254, 255));
    expect(hex).toBe("\\x0001feff");
    expect([...fromByteaHex(hex)]).toEqual([0, 1, 254, 255]);
  });
});
