// The API returns at most 1,000 rows per request (supabase/config.toml
// max_rows), so a read that may be longer goes a page at a time. `page`
// runs the query for one range of rows; it must have a stable order.
// Stops on an empty page, or once more than `limit` rows are in, so a
// caller can tell whether there were more than it wanted.
export const PAGE_SIZE = 1000;

export async function readAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  limit = Infinity,
): Promise<T[]> {
  const rows: T[] = [];
  while (rows.length <= limit) {
    const { data, error } = await page(rows.length, rows.length + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    rows.push(...data);
  }
  return rows;
}
