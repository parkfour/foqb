import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface JournalLineInput {
  account_id: string;
  debit: number;
  credit: number;
}

interface JournalEntryRequestBody {
  organization_id: string;
  entry_date: string;
  memo: string;
  lines: JournalLineInput[];
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Partial<JournalEntryRequestBody>;
  const { organization_id, entry_date, memo, lines } = body;

  if (!organization_id || !entry_date || !Array.isArray(lines) || lines.length === 0) {
    return NextResponse.json(
      { error: "organization_id, entry_date, and lines are required" },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("id")
    .eq("organization_id", organization_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Summed in whole cents: float sums like 0.1 + 0.2 !== 0.3 would
  // otherwise reject balanced entries.
  const toCents = (value: number | undefined) => Math.round((value ?? 0) * 100);
  const totalDebit = lines.reduce((sum, line) => sum + toCents(line.debit), 0);
  const totalCredit = lines.reduce((sum, line) => sum + toCents(line.credit), 0);

  if (totalDebit !== totalCredit || totalDebit === 0) {
    return NextResponse.json(
      { error: "Total debits must equal total credits and be greater than zero" },
      { status: 400 },
    );
  }

  const { data: organization } = await supabase
    .from("organizations")
    .select("period_lock_date")
    .eq("id", organization_id)
    .maybeSingle();

  const periodLockDate = organization?.period_lock_date as string | null | undefined;

  if (periodLockDate && entry_date <= periodLockDate) {
    return NextResponse.json(
      { error: "entry_date falls within a locked period" },
      { status: 400 },
    );
  }

  const { data: entryId, error: postError } = await supabase.rpc("post_journal_entry", {
    p_org_id: organization_id,
    p_entry_date: entry_date,
    p_memo: memo,
    p_lines: lines.map((line) => ({
      account_id: line.account_id,
      debit: line.debit,
      credit: line.credit,
    })),
  });

  if (postError || !entryId) {
    // The database refusing the entry itself (a raised exception, invalid
    // input, a bad account, a permission check) is the client's problem and
    // won't change on retry; anything else may be an outage.
    const rejected = /^(P0001|22|23|42501)/.test(postError?.code ?? "");
    return NextResponse.json(
      { error: postError?.message ?? "Failed to create journal entry" },
      { status: rejected ? 400 : 500 },
    );
  }

  return NextResponse.json({ success: true, id: entryId as string });
}
