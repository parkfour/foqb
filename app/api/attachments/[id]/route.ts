import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fromByteaHex } from "@/lib/attachments";

// The file, shown in the browser (?download for a download). Only types
// checked on the way in are stored, and the headers keep the browser from
// treating one as anything else.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("attachments")
    .select("file_name, content_type, data")
    .eq("id", id)
    .maybeSingle();
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const disposition = req.nextUrl.searchParams.has("download") ? "attachment" : "inline";
  return new NextResponse(new Uint8Array(fromByteaHex(data.data as string)), {
    headers: {
      "Content-Type": data.content_type as string,
      "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(data.file_name as string)}`,
      "X-Content-Type-Options": "nosniff",
      // Chrome won't show a PDF under a sandbox policy; images can take it.
      ...(data.content_type === "application/pdf" ? {} : { "Content-Security-Policy": "sandbox; default-src 'none'" }),
      "Cache-Control": "private, no-store",
    },
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase.from("attachments").delete().eq("id", id).select("id");
  if (error) return NextResponse.json({ error: "Couldn't remove the attachment" }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "Not found, or you can't remove it" }, { status: 404 });
  return NextResponse.json({ success: true });
}
