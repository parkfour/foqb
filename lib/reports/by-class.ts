import { createClient } from "@/lib/supabase/server";

export interface ByClassRow {
  account_id: string;
  account_number: string;
  name: string;
  type: "revenue" | "expense";
  class_id: string | null;
  amount: number;
}

export interface ByClassTable {
  // Column keys: class ids, then "" for unclassified when any line is.
  columns: { key: string; name: string }[];
  rows: { account_id: string; account_number: string; name: string; type: "revenue" | "expense"; amounts: Record<string, number> }[];
}

export function pivotByClass(rows: ByClassRow[], classes: { id: string; name: string }[]): ByClassTable {
  const used = new Set(rows.map((r) => r.class_id ?? ""));
  const columns = [
    ...classes.filter((c) => used.has(c.id)).map((c) => ({ key: c.id, name: c.name })),
    ...(used.has("") ? [{ key: "", name: "Unclassified" }] : []),
  ];
  const byAccount = new Map<string, ByClassTable["rows"][number]>();
  for (const r of rows) {
    const row = byAccount.get(r.account_id) ?? { account_id: r.account_id, account_number: r.account_number, name: r.name, type: r.type, amounts: {} };
    const key = r.class_id ?? "";
    row.amounts[key] = (row.amounts[key] ?? 0) + Number(r.amount);
    byAccount.set(r.account_id, row);
  }
  return { columns, rows: [...byAccount.values()] };
}

export async function fetchIncomeStatementByClass(orgId: string, start: string, end: string): Promise<ByClassTable> {
  const supabase = await createClient();
  const [{ data, error }, { data: classes }] = await Promise.all([
    supabase.rpc("get_income_statement_by_class", { p_org_id: orgId, p_start_date: start, p_end_date: end }),
    supabase.from("classes").select("id, name").eq("organization_id", orgId).order("name"),
  ]);
  if (error) throw error;
  return pivotByClass((data ?? []) as ByClassRow[], (classes ?? []) as { id: string; name: string }[]);
}
