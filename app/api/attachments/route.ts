import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { MAX_ATTACHMENT_BYTES, cleanFileName, detectAttachmentType, toByteaHex } from "@/lib/attachments";

// Attach a file to a journal entry. Multipart: journal_entry_id and file.
// Row-level security decides who may (a writer in the entry's book).
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const entryId = form?.get("journal_entry_id");
  const file = form?.get("file");
  if (typeof entryId !== "string" || !(file instanceof File)) {
    return NextResponse.json({ error: "A journal entry and a file are required" }, { status: 400 });
  }
  if (file.size === 0 || file.size > MAX_ATTACHMENT_BYTES) {
    return NextResponse.json({ error: "A file can be up to 4 MB" }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentType = detectAttachmentType(bytes);
  if (!contentType) {
    return NextResponse.json({ error: "Attach a PDF or a photo (JPEG, PNG, WebP, HEIC or GIF)" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: entry } = await supabase
    .from("journal_entries")
    .select("id, organization_id")
    .eq("id", entryId)
    .maybeSingle();
  if (!entry) return NextResponse.json({ error: "Journal entry not found" }, { status: 404 });

  const { data, error } = await supabase
    .from("attachments")
    .insert({
      organization_id: entry.organization_id,
      journal_entry_id: entry.id,
      file_name: cleanFileName(file.name),
      content_type: contentType,
      size_bytes: bytes.length,
      data: toByteaHex(bytes),
    })
    .select("id, file_name, content_type, size_bytes, created_at")
    .single();

  if (error) {
    const forbidden = error.code === "42501";
    return NextResponse.json(
      { error: forbidden ? "Only an owner or accountant can attach files" : "Couldn't save the attachment" },
      { status: forbidden ? 403 : 500 },
    );
  }
  return NextResponse.json({ attachment: data });
}
