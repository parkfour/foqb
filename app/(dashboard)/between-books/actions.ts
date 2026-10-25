"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { sideLines, validateBetweenBooks, type BookSide } from "@/lib/between-books";

export type BetweenBooksResult = { error: string } | { ok: true; entryId: string };

export async function postBetweenBooks(_prev: BetweenBooksResult | null, formData: FormData): Promise<BetweenBooksResult> {
  const get = (name: string) => ((formData.get(name) as string | null) ?? "").trim();
  const side = (prefix: "a" | "b"): BookSide => ({
    orgId: get(`${prefix}Org`),
    debitAccountId: get(`${prefix}Debit`),
    creditAccountId: get(`${prefix}Credit`),
    bankTransactionId: get(`${prefix}Bank`) || null,
  });
  const input = { kind: get("kind"), date: get("date"), amount: Number(get("amount")), memo: get("memo"), a: side("a"), b: side("b") };
  const invalid = validateBetweenBooks(input);
  if (invalid) return { error: invalid };

  const supabase = await createClient();
  const { data: linkId, error } = await supabase.rpc("post_between_books", {
    p_kind: input.kind,
    p_entry_date: input.date,
    p_memo: input.memo || null,
    p_a: { org_id: input.a.orgId, lines: sideLines(input.a, input.amount), bank_transaction_id: input.a.bankTransactionId },
    p_b: { org_id: input.b.orgId, lines: sideLines(input.b, input.amount), bank_transaction_id: input.b.bankTransactionId },
  });
  if (error) {
    return {
      error: /row-level security|permission/i.test(error.message)
        ? "You need to be an owner or accountant in both books"
        : error.message,
    };
  }

  const { data: link } = await supabase
    .from("inter_book_links")
    .select("entry_a")
    .eq("id", linkId as string)
    .maybeSingle();
  revalidatePath("/journal");
  return { ok: true, entryId: (link?.entry_a as string | undefined) ?? "" };
}
