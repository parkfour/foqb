// Bank Transactions' filters, read from and written to its URL.
export const FEED_PAGE_SIZE = 100;
export const FEED_STATUSES = ["unreconciled", "matched", "ignored"] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface FeedParams {
  q?: string;
  account?: string;
  status?: string;
  page?: string;
}

export function parseFeedFilters(params: FeedParams) {
  const search = params.q?.trim() ?? "";
  const account = UUID.test(params.account ?? "") ? params.account : undefined;
  const status = FEED_STATUSES.find((value) => value === params.status);
  const page = Math.max(1, Math.floor(Number(params.page)) || 1);
  return { search, account, status, page, isFiltered: Boolean(search || account || status) };
}

// An ILIKE pattern matching `search` anywhere, its own % and _ taken literally.
export function containsPattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

// The page's URL with the filters kept and the given ones changed.
export function feedHref(params: FeedParams, changes: FeedParams): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, ...changes })) {
    if (value) query.set(key, value);
  }
  const text = query.toString();
  return text ? `/transactions?${text}` : "/transactions";
}
