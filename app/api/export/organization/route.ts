import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId, getCurrentUserRole } from "@/lib/org/current";
import { buildOrganizationSnapshot } from "@/lib/org/export-snapshot";

export async function GET() {
  const orgId = await getCurrentOrgId();

  if (!orgId) {
    return NextResponse.json({ error: "No organization found" }, { status: 404 });
  }

  // Stricter than RLS alone: a viewer or accountant can already read most
  // of this data, but the backup export is deliberately owner-only.
  const role = await getCurrentUserRole(orgId);
  if (role !== "owner") {
    return NextResponse.json({ error: "Only an owner can download a backup" }, { status: 403 });
  }

  const supabase = await createClient();
  const snapshot = await buildOrganizationSnapshot(supabase, orgId);

  return new NextResponse(JSON.stringify(snapshot, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="foqb-backup-${orgId}.json"`,
    },
  });
}
