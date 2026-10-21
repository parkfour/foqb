import type { SupabaseClient } from "@supabase/supabase-js";
import { ACCOUNT_TYPE_BASE, type DefaultAccount } from "@/lib/org/default-accounts";

// Assigns the next free number in each type's block (e.g. 1000s for asset)
// for a whole batch of accounts at once — one DB query per distinct type,
// then allocated sequentially in memory, so multiple accounts of the same
// type created together (e.g. several accounts from one Plaid Link session)
// don't collide by each independently computing the same "next" number
// before any of them are actually committed.
export async function nextAccountNumbers(
  supabase: SupabaseClient,
  organizationId: string,
  types: DefaultAccount["type"][],
): Promise<string[]> {
  const nextByType = new Map<DefaultAccount["type"], number>();

  for (const type of new Set(types)) {
    const base = ACCOUNT_TYPE_BASE[type];

    const { data } = await supabase
      .from("accounts")
      .select("account_number")
      .eq("organization_id", organizationId)
      .eq("type", type);

    const numbersInBlock = ((data ?? []) as { account_number: string }[])
      .map((row) => parseInt(row.account_number, 10))
      .filter((n) => Number.isFinite(n) && n >= base && n < base + 1000);

    nextByType.set(type, numbersInBlock.length > 0 ? Math.max(...numbersInBlock) + 1 : base);
  }

  return types.map((type) => {
    const next = nextByType.get(type)!;
    nextByType.set(type, next + 1);
    return String(next);
  });
}

export async function nextAccountNumber(
  supabase: SupabaseClient,
  organizationId: string,
  type: DefaultAccount["type"],
): Promise<string> {
  const [number] = await nextAccountNumbers(supabase, organizationId, [type]);
  return number;
}
