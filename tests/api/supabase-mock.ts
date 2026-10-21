import { vi, type Mock } from "vitest";

export type QueryResult<T = unknown> =
  | { data: T; error: null }
  | { data: null; error: { message: string; code?: string } };

export function ok<T>(data: T): QueryResult<T> {
  return { data, error: null };
}

export function fail(message: string, code?: string): QueryResult<null> {
  return { data: null, error: { message, code } };
}

interface TableConfig {
  select?: QueryResult;
  insert?: QueryResult;
  update?: QueryResult;
  delete?: QueryResult;
  upsert?: QueryResult;
}

interface TableQueryBuilder {
  select: Mock<(...args: unknown[]) => TableQueryBuilder>;
  insert: Mock<(...args: unknown[]) => TableQueryBuilder>;
  update: Mock<(...args: unknown[]) => TableQueryBuilder>;
  delete: Mock<(...args: unknown[]) => TableQueryBuilder>;
  upsert: Mock<(...args: unknown[]) => TableQueryBuilder>;
  eq: Mock<(...args: unknown[]) => TableQueryBuilder>;
  neq: Mock<(...args: unknown[]) => TableQueryBuilder>;
  in: Mock<(...args: unknown[]) => TableQueryBuilder>;
  lt: Mock<(...args: unknown[]) => TableQueryBuilder>;
  lte: Mock<(...args: unknown[]) => TableQueryBuilder>;
  is: Mock<(...args: unknown[]) => TableQueryBuilder>;
  not: Mock<(...args: unknown[]) => TableQueryBuilder>;
  ilike: Mock<(...args: unknown[]) => TableQueryBuilder>;
  contains: Mock<(...args: unknown[]) => TableQueryBuilder>;
  order: Mock<(...args: unknown[]) => TableQueryBuilder>;
  limit: Mock<(...args: unknown[]) => TableQueryBuilder>;
  range: Mock<(from: number, to: number) => TableQueryBuilder>;
  single: Mock<() => Promise<QueryResult>>;
  maybeSingle: Mock<() => Promise<QueryResult>>;
  then: (
    resolve: (value: QueryResult) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise<unknown>;
}

// Mimics the subset of the Supabase JS query builder our routes use: every
// chain method returns the same builder, and the builder itself is a
// thenable (so `await supabase.from(t).update(x).eq("id", y)` resolves)
// as well as exposing `.single()` / `.maybeSingle()` terminals.
export function createTableMock(config: TableConfig): TableQueryBuilder {
  let pending: QueryResult = ok(null);
  // True once a write has set `pending` from its OWN dedicated config (e.g.
  // `.insert(x).select().single()` asking for the inserted row back) — the
  // trailing `.select()` must not clobber that. False when a write ran with
  // no dedicated config of its own (e.g. `.delete().select("key")` used
  // purely to get the affected rows back for counting) — there, `.select()`
  // is the intended source of the write's "returning" payload, matching
  // config.select. Reset on every terminal call so an unrelated later read
  // on the same table (a fresh `.select()` chain) still uses config.select.
  let pendingIsAuthoritative = false;
  // `.range(from, to)` pages through config.select's rows like the real API.
  let pageRange: [number, number] | null = null;
  const result = (): QueryResult => {
    const range = pageRange;
    pageRange = null;
    if (!range || !Array.isArray(pending.data)) return pending;
    return { data: pending.data.slice(range[0], range[1] + 1), error: null };
  };

  const builder: TableQueryBuilder = {
    select: vi.fn<(...args: unknown[]) => TableQueryBuilder>(() => {
      if (!pendingIsAuthoritative && config.select) pending = config.select;
      return builder;
    }),
    insert: vi.fn<(...args: unknown[]) => TableQueryBuilder>(() => {
      if (config.insert) {
        pending = config.insert;
        pendingIsAuthoritative = true;
      }
      return builder;
    }),
    update: vi.fn<(...args: unknown[]) => TableQueryBuilder>(() => {
      if (config.update) {
        pending = config.update;
        pendingIsAuthoritative = true;
      }
      return builder;
    }),
    delete: vi.fn<(...args: unknown[]) => TableQueryBuilder>(() => {
      if (config.delete) {
        pending = config.delete;
        pendingIsAuthoritative = true;
      }
      return builder;
    }),
    upsert: vi.fn<(...args: unknown[]) => TableQueryBuilder>(() => {
      if (config.upsert) {
        pending = config.upsert;
        pendingIsAuthoritative = true;
      }
      return builder;
    }),
    eq: vi.fn<(...args: unknown[]) => TableQueryBuilder>(() => builder),
    neq: vi.fn<(...args: unknown[]) => TableQueryBuilder>(() => builder),
    in: vi.fn<(...args: unknown[]) => TableQueryBuilder>(() => builder),
    lt: vi.fn<(...args: unknown[]) => TableQueryBuilder>(() => builder),
    lte: vi.fn<(...args: unknown[]) => TableQueryBuilder>(() => builder),
    is: vi.fn<(...args: unknown[]) => TableQueryBuilder>(() => builder),
    not: vi.fn<(...args: unknown[]) => TableQueryBuilder>(() => builder),
    ilike: vi.fn<(...args: unknown[]) => TableQueryBuilder>(() => builder),
    contains: vi.fn<(...args: unknown[]) => TableQueryBuilder>(() => builder),
    order: vi.fn<(...args: unknown[]) => TableQueryBuilder>(() => builder),
    limit: vi.fn<(...args: unknown[]) => TableQueryBuilder>(() => builder),
    range: vi.fn<(from: number, to: number) => TableQueryBuilder>((from, to) => {
      pageRange = [from, to];
      return builder;
    }),
    single: vi.fn(() => {
      pendingIsAuthoritative = false;
      return Promise.resolve(pending);
    }),
    maybeSingle: vi.fn(() => {
      pendingIsAuthoritative = false;
      return Promise.resolve(pending);
    }),
    then: (
      resolve: (value: QueryResult) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => {
      pendingIsAuthoritative = false;
      return Promise.resolve(result()).then(resolve, reject);
    },
  };

  return builder;
}

interface SupabaseMockConfig {
  user?: { id: string } | null;
  tables: Record<string, TableConfig>;
  rpc?: QueryResult;
  // Per-function results, for code that calls more than one RPC; falls
  // back to `rpc` for names not listed.
  rpcs?: Record<string, QueryResult>;
  // Session assurance level for auth.mfa.getAuthenticatorAssuranceLevel();
  // defaults to a session that has completed two-factor.
  aal?: "aal1" | "aal2";
  // Only relevant when mocking createAdminClient (regular RLS-scoped
  // clients never expose auth.admin).
  authAdmin?: {
    getUserById?: Mock;
    deleteUser?: Mock;
    createUser?: Mock;
    updateUserById?: Mock;
  };
}

export function createSupabaseMock(config: SupabaseMockConfig) {
  const tables: Record<string, ReturnType<typeof createTableMock>> = {};

  for (const [table, tableConfig] of Object.entries(config.tables)) {
    tables[table] = createTableMock(tableConfig);
  }

  const client = {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: config.user ?? null }, error: null })),
      mfa: {
        getAuthenticatorAssuranceLevel: vi.fn(async () => ({
          data: { currentLevel: config.aal ?? "aal2", nextLevel: config.aal ?? "aal2" },
          error: null,
        })),
      },
      admin: {
        getUserById:
          config.authAdmin?.getUserById ??
          vi.fn(async () => ({ data: { user: null }, error: null })),
        deleteUser: config.authAdmin?.deleteUser ?? vi.fn(async () => ({ data: null, error: null })),
        createUser:
          config.authAdmin?.createUser ??
          vi.fn(async () => ({ data: { user: null }, error: null })),
        updateUserById:
          config.authAdmin?.updateUserById ?? vi.fn(async () => ({ data: null, error: null })),
      },
    },
    from: vi.fn((table: string) => {
      const mock = tables[table];
      if (!mock) {
        throw new Error(`Unexpected supabase.from("${table}") call in this test`);
      }
      return mock;
    }),
    rpc: vi.fn<(name: string, args?: unknown) => Promise<QueryResult>>(
      async (name) => config.rpcs?.[name] ?? config.rpc ?? ok(null),
    ),
  };

  return { client, tables };
}
