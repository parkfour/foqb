import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";
import type { CountryCode, Products } from "plaid";

function getClient(): PlaidApi {
  const env = process.env.PLAID_ENV ?? "sandbox";
  const basePath = PlaidEnvironments[env as keyof typeof PlaidEnvironments];

  if (!basePath) {
    throw new Error(`Unknown PLAID_ENV "${env}" — expected sandbox or production`);
  }

  const configuration = new Configuration({
    basePath,
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID,
        "PLAID-SECRET": process.env.PLAID_SECRET,
      },
    },
  });

  return new PlaidApi(configuration);
}

const TRANSACTION_HISTORY_DAYS = 730;

// A Link token authorizes one Link session for one user — created
// server-side, then handed to the frontend to open Plaid Link with.
// With an access token it opens Link in update mode instead: the user
// re-authenticates an existing Item (expired login, new MFA, ...), which
// keeps its Item, account and transaction ids, so nothing is re-imported.
export async function createLinkToken(clientUserId: string, accessToken?: string): Promise<string> {
  const client = getClient();
  const common = {
    client_name: "FOQB",
    user: { client_user_id: clientUserId },
    country_codes: ["US"] as CountryCode[],
    language: "en",
    webhook: process.env.PLAID_WEBHOOK_URL,
    // Where banks that sign in on their own site (OAuth) send the user back
    // when Link can't use a popup (common on phones) — /settings/bank-return.
    // Must also be registered in Plaid's dashboard.
    ...(process.env.PLAID_REDIRECT_URI ? { redirect_uri: process.env.PLAID_REDIRECT_URI } : {}),
  };
  const response = await client.linkTokenCreate(
    accessToken
      ? { ...common, access_token: accessToken }
      : {
          ...common,
          products: ["transactions"] as Products[],
          // Plaid's default is 90 days; bookkeeping wants as much history as
          // the bank will give (730 is the maximum). Only applies when the
          // Item is first created.
          transactions: { days_requested: TRANSACTION_HISTORY_DAYS },
        },
  );

  return response.data.link_token;
}

export async function exchangePublicToken(
  publicToken: string,
): Promise<{ accessToken: string; itemId: string }> {
  const client = getClient();
  const response = await client.itemPublicTokenExchange({ public_token: publicToken });

  return { accessToken: response.data.access_token, itemId: response.data.item_id };
}

export interface PlaidAccount {
  id: string;
  name: string;
  type: string;
  subtype: string | null;
  mask: string | null;
}

export async function getAccounts(accessToken: string): Promise<PlaidAccount[]> {
  const client = getClient();
  const response = await client.accountsGet({ access_token: accessToken });

  return response.data.accounts.map((account) => ({
    id: account.account_id,
    name: account.name,
    type: account.type,
    subtype: account.subtype ?? null,
    mask: account.mask ?? null,
  }));
}

export interface PlaidTransaction {
  id: string;
  account_id: string;
  // Plaid's sign convention: positive = money out (expense), negative =
  // money in (deposit) — the OPPOSITE of this app's internal convention.
  // Callers must negate before storing/posting.
  amount: number;
  date: string;
  name: string;
}

export interface SyncResult {
  added: PlaidTransaction[];
  modified: PlaidTransaction[];
  removed: { id: string; accountId: string }[];
  nextCursor: string;
  hasMore: boolean;
}

function toPlaidTransaction(tx: { transaction_id: string; account_id: string; amount: number; date: string; name: string }): PlaidTransaction {
  return { id: tx.transaction_id, account_id: tx.account_id, amount: tx.amount, date: tx.date, name: tx.name };
}

export async function syncTransactions(
  accessToken: string,
  cursor: string | null,
): Promise<SyncResult> {
  const client = getClient();
  const response = await client.transactionsSync({
    access_token: accessToken,
    cursor: cursor ?? undefined,
  });

  // Pending transactions aren't booked: when one clears, Plaid removes it
  // and re-adds it under a new id, so posting the pending copy would book
  // (and then have to unwind) an entry that a user may have already matched
  // or reconciled. Only the cleared copy is ever posted to the ledger.
  const cleared = (tx: { pending: boolean }) => !tx.pending;

  return {
    added: response.data.added.filter(cleared).map(toPlaidTransaction),
    modified: response.data.modified.filter(cleared).map(toPlaidTransaction),
    removed: response.data.removed.map((tx) => ({
      id: tx.transaction_id as string,
      accountId: tx.account_id as string,
    })),
    nextCursor: response.data.next_cursor,
    hasMore: response.data.has_more,
  };
}

export async function removeItem(accessToken: string): Promise<void> {
  const client = getClient();
  await client.itemRemove({ access_token: accessToken });
}

export interface WebhookVerificationKey {
  alg: string;
  crv: string;
  kty: string;
  use: string;
  x: string;
  y: string;
  kid: string;
  // Set once Plaid has rotated the key out; a webhook signed with it must
  // be rejected.
  expired_at: number | null;
}

// Cached to avoid a round trip to Plaid on every webhook delivery, but only
// for a day: a key can be expired after we first fetched it, and a
// forever-cached copy would never show its expired_at.
const KEY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const keyCache = new Map<string, { key: WebhookVerificationKey; fetchedAt: number }>();

export async function getWebhookVerificationKey(keyId: string): Promise<WebhookVerificationKey> {
  const cached = keyCache.get(keyId);
  if (cached && Date.now() - cached.fetchedAt < KEY_CACHE_TTL_MS) return cached.key;

  const client = getClient();
  const response = await client.webhookVerificationKeyGet({ key_id: keyId });
  const key = response.data.key as unknown as WebhookVerificationKey;
  keyCache.set(keyId, { key, fetchedAt: Date.now() });

  return key;
}

// Plaid's API errors arrive as an HTTP error whose body says what was wrong
// (error_type, error_code, error_message, request_id) — the bare
// "Request failed with status code 400" alone isn't diagnosable. The body
// never contains credentials, so it's safe to log.
export function describePlaidError(error: unknown): string {
  const data = (error as { response?: { data?: Record<string, unknown> } })?.response?.data;
  if (data && typeof data === "object") {
    const { error_type, error_code, error_message, request_id } = data;
    return `Plaid ${String(error_type)}/${String(error_code)}: ${String(error_message)} (request ${String(request_id)})`;
  }
  return error instanceof Error ? error.message : String(error);
}
