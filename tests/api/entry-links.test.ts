import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseMock, ok } from "./supabase-mock";
import { entryHrefs } from "@/lib/reports/entry-links";

describe("entryHrefs", () => {
  it("opens a fed entry in the register, preferring this account's own feed, and anything else as an entry", async () => {
    const { client, tables } = createSupabaseMock({
      tables: {
        bank_transactions: {
          select: ok([
            // A transfer: both sides share the entry; the card's own row wins.
            { id: "bt-checking", account_id: "checking", journal_entry_id: "je-transfer" },
            { id: "bt-card", account_id: "card", journal_entry_id: "je-transfer" },
            { id: "bt-coffee", account_id: "checking", journal_entry_id: "je-coffee" },
          ]),
        },
      },
    });

    const hrefFor = await entryHrefs(client as unknown as SupabaseClient, "org-1", "card");

    expect(tables.bank_transactions.eq).toHaveBeenCalledWith("journal_entries.journal_lines.account_id", "card");
    expect(hrefFor("je-transfer")).toBe("/register?account=card&tx=bt-card");
    expect(hrefFor("je-coffee")).toBe("/register?account=checking&tx=bt-coffee");
    expect(hrefFor("je-manual")).toBe("/journal/je-manual");
  });
});
