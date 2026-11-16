import type { SupabaseClient } from "@supabase/supabase-js";

// Items that are stock: tracked, with an inventory and a cost of goods sold
// account (migration 086).
export interface StockItem {
  id: string;
  inventory_account_id: string;
  cogs_account_id: string;
  unit_cost: number;
}

export interface StockMove {
  item_id: string;
  quantity: number;
  unit_cost: number;
}

export async function fetchStockItems(supabase: SupabaseClient, orgId: string, itemIds: (string | null)[]): Promise<Map<string, StockItem>> {
  const ids = [...new Set(itemIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase
    .from("items")
    .select("id, inventory_account_id, cogs_account_id, unit_cost")
    .eq("organization_id", orgId)
    .eq("track_quantity", true)
    .not("inventory_account_id", "is", null)
    .not("cogs_account_id", "is", null)
    .in("id", ids);
  if (error) throw error;
  return new Map(((data ?? []) as StockItem[]).map((i) => [i.id, { ...i, unit_cost: Number(i.unit_cost) }]));
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// Selling: cost of goods sold debited and inventory credited at each item's
// average cost, and a move taking the quantity off the count.
export function saleCostLines(
  lines: { item_id: string | null; quantity: number }[],
  stock: Map<string, StockItem>,
): { journalLines: { account_id: string; debit: number; credit: number }[]; moves: StockMove[] } {
  const journalLines: { account_id: string; debit: number; credit: number }[] = [];
  const moves: StockMove[] = [];
  for (const line of lines) {
    const item = line.item_id ? stock.get(line.item_id) : undefined;
    if (!item) continue;
    moves.push({ item_id: item.id, quantity: -line.quantity, unit_cost: item.unit_cost });
    const cost = round2(line.quantity * item.unit_cost);
    if (cost > 0) {
      journalLines.push({ account_id: item.cogs_account_id, debit: cost, credit: 0 });
      journalLines.push({ account_id: item.inventory_account_id, debit: 0, credit: cost });
    }
  }
  return { journalLines, moves };
}

// Buying: the new average cost after adding quantity at price to what's on
// hand (none on hand, or less than none, starts from the price).
export function averageCost(onHand: number, cost: number, quantity: number, price: number): number {
  const before = Math.max(onHand, 0);
  if (before + quantity <= 0) return price;
  return Math.round(((before * cost + quantity * price) / (before + quantity)) * 10000) / 10000;
}

export async function recordMoves(
  supabase: SupabaseClient,
  orgId: string,
  journalEntryId: string,
  moves: StockMove[],
): Promise<string | null> {
  if (moves.length === 0) return null;
  const { error } = await supabase
    .from("inventory_moves")
    .insert(moves.map((m) => ({ organization_id: orgId, journal_entry_id: journalEntryId, ...m })));
  return error?.message ?? null;
}

// After a purchase is booked: each bought item's average cost, from what
// was on hand before it. Voiding the bill undoes it (revertAverageCosts).
export async function updateAverageCosts(supabase: SupabaseClient, stock: Map<string, StockItem>, bought: StockMove[]): Promise<void> {
  for (const move of bought) {
    const item = stock.get(move.item_id);
    if (!item) continue;
    const { data } = await supabase.from("item_stock").select("on_hand").eq("item_id", item.id).maybeSingle();
    const onHandAfter = Number((data as { on_hand: number } | null)?.on_hand ?? 0);
    const cost = averageCost(onHandAfter - move.quantity, item.unit_cost, move.quantity, move.unit_cost);
    item.unit_cost = cost;
    await supabase.from("items").update({ unit_cost: cost }).eq("id", item.id);
  }
}

// Voiding a purchase: the average cost without quantity bought at value
// (quantity × price), when onHand is what's left without it. Nothing left,
// or a negative result (the stock moved at other costs since), keeps the
// cost as it is.
export function averageCostWithout(onHand: number, cost: number, quantity: number, value: number): number {
  if (onHand <= 0) return cost;
  const without = ((onHand + quantity) * cost - value) / onHand;
  return without < 0 ? cost : Math.round(without * 10000) / 10000;
}

// After a bill is voided (its entry no longer posted, so item_stock already
// leaves its moves out): takes its purchases back out of each item's
// average cost.
export async function revertAverageCosts(supabase: SupabaseClient, journalEntryId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("inventory_moves")
    .select("item_id, quantity, unit_cost, items(unit_cost)")
    .eq("journal_entry_id", journalEntryId)
    .gt("quantity", 0);
  if (error) return error.message;
  const bought = new Map<string, { quantity: number; value: number; cost: number }>();
  for (const m of (data ?? []) as unknown as { item_id: string; quantity: number; unit_cost: number; items: { unit_cost: number } | null }[]) {
    const sum = bought.get(m.item_id) ?? { quantity: 0, value: 0, cost: Number(m.items?.unit_cost ?? 0) };
    sum.quantity += Number(m.quantity);
    sum.value += Number(m.quantity) * Number(m.unit_cost);
    bought.set(m.item_id, sum);
  }
  for (const [itemId, b] of bought) {
    const { data: stock } = await supabase.from("item_stock").select("on_hand").eq("item_id", itemId).maybeSingle();
    const onHand = Number((stock as { on_hand: number } | null)?.on_hand ?? 0);
    const cost = averageCostWithout(onHand, b.cost, b.quantity, b.value);
    if (cost === b.cost) continue;
    const { error: updateError } = await supabase.from("items").update({ unit_cost: cost }).eq("id", itemId);
    if (updateError) return updateError.message;
  }
  return null;
}
