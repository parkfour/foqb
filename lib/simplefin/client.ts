import { request } from "node:https";
import { isIP } from "node:net";
import { publicLookup, resolvePublicAddress } from "@/lib/net/public-address";
import type { PlaidTransaction } from "@/lib/plaid/client";
import { localDate } from "@/lib/time/book-time";

// SimpleFIN (https://www.simplefin.org/protocol.html): the person buys
// access at a SimpleFIN Bridge, connects their banks there, and pastes a
// setup token here. The token is claimed once for an access URL, which
// carries its own credentials and is kept encrypted like a Plaid token.

const TIMEOUT_MS = 60_000;
const MAX_BODY_BYTES = 20 * 1024 * 1024;

export interface SimplefinTransaction {
  id: string;
  posted: number;
  amount: string;
  description: string;
  payee?: string;
  pending?: boolean;
}

export interface SimplefinAccount {
  id: string;
  name: string;
  currency: string;
  balance: string;
  "available-balance"?: string;
  org?: { name?: string; domain?: string };
  transactions?: SimplefinTransaction[];
}

export interface SimplefinAccountSet {
  errors: string[];
  accounts: SimplefinAccount[];
}

// One HTTPS request to a public address (the server is the person's
// choice, through their token), no redirects followed.
function fetchText(url: URL, method: "GET" | "POST", headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method, lookup: publicLookup, headers: { "user-agent": "FOQB", ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) req.destroy(new Error("SimpleFIN's answer was too large"));
        else chunks.push(chunk);
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    const timer = setTimeout(() => req.destroy(new Error("SimpleFIN didn't answer in time")), TIMEOUT_MS);
    req.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    req.on("close", () => clearTimeout(timer));
    req.end();
  });
}

async function checkHost(url: URL): Promise<void> {
  if (url.protocol !== "https:") throw new Error("SimpleFIN addresses must use https");
  // Node skips `lookup` for an address written in the URL, so check it here.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) await resolvePublicAddress(host);
}

// The claim URL inside a setup token (base64 of an https URL).
export function claimUrlFromSetupToken(setupToken: string): URL {
  let decoded: string;
  try {
    decoded = Buffer.from(setupToken.trim(), "base64").toString("utf8");
  } catch {
    throw new Error("That isn't a SimpleFIN setup token");
  }
  let url: URL;
  try {
    url = new URL(decoded);
  } catch {
    throw new Error("That isn't a SimpleFIN setup token");
  }
  if (url.protocol !== "https:") throw new Error("That isn't a SimpleFIN setup token");
  return url;
}

// Claims a setup token for its access URL. A token works once.
export async function claimSetupToken(setupToken: string): Promise<string> {
  const claimUrl = claimUrlFromSetupToken(setupToken);
  await checkHost(claimUrl);
  const { status, body } = await fetchText(claimUrl, "POST", { "content-length": "0" });
  if (status === 403) throw new Error("That setup token was already used or has expired. Make a new one at your SimpleFIN Bridge.");
  if (status < 200 || status >= 300) throw new Error(`SimpleFIN refused the setup token (${status})`);
  const accessUrl = new URL(body.trim());
  await checkHost(accessUrl);
  if (!accessUrl.username) throw new Error("SimpleFIN's answer wasn't an access URL");
  return accessUrl.toString();
}

export class SimplefinAuthError extends Error {}

const unixDay = (date: string) => String(Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000));

// The accounts, and their transactions posted from `startDate` up to
// `endDate` (YYYY-MM-DD, end not included) unless balancesOnly.
export async function getAccountSet(
  accessUrl: string,
  startDate: string | null,
  balancesOnly = false,
  endDate: string | null = null,
): Promise<SimplefinAccountSet> {
  const base = new URL(accessUrl);
  await checkHost(base);
  const auth = Buffer.from(`${decodeURIComponent(base.username)}:${decodeURIComponent(base.password)}`).toString("base64");
  const url = new URL(base.pathname.replace(/\/$/, "") + "/accounts", base.origin);
  if (startDate) url.searchParams.set("start-date", unixDay(startDate));
  if (endDate) url.searchParams.set("end-date", unixDay(endDate));
  if (balancesOnly) url.searchParams.set("balances-only", "1");

  const { status, body } = await fetchText(url, "GET", { authorization: `Basic ${auth}` });
  if (status === 401 || status === 403) throw new SimplefinAuthError("SimpleFIN no longer accepts this connection");
  if (status < 200 || status >= 300) throw new Error(`SimpleFIN answered ${status}`);
  const set = JSON.parse(body) as Partial<SimplefinAccountSet>;
  return { errors: set.errors ?? [], accounts: set.accounts ?? [] };
}

// How a SimpleFIN account is known in the ledger (accounts.
// external_account_id) and its transactions in the bank feed.
export function externalAccountId(account: Pick<SimplefinAccount, "id">): string {
  return `sfin:${account.id}`;
}

// SimpleFIN doesn't say what kind an account is. Money owed shows as a
// negative balance, and the names say the rest.
// ponytail: a guess; a positive-balance card named oddly lands as an asset.
export function simplefinAccountType(account: Pick<SimplefinAccount, "name" | "balance">): "asset" | "liability" {
  if (Number(account.balance) < 0) return "liability";
  return /credit|card|visa|mastercard|amex|loan|mortgage|heloc|line of credit/i.test(account.name) ? "liability" : "asset";
}

// Posted transactions in the processor's shape. SimpleFIN's sign is the
// app's own (negative = money out); PlaidTransaction's is the opposite.
// Pending ones are left for a later sync, once they've posted. Dated in
// the book's timezone: SimpleFIN gives a moment, not a day.
export function toFeedTransactions(account: SimplefinAccount, timeZone: string): PlaidTransaction[] {
  return (account.transactions ?? [])
    .filter((tx) => !tx.pending && tx.posted > 0)
    .map((tx) => ({
      id: `${externalAccountId(account)}:${tx.id}`,
      account_id: externalAccountId(account),
      amount: -Number(tx.amount),
      date: localDate(timeZone, new Date(tx.posted * 1000)),
      name: (tx.payee || tx.description || "").trim() || "Transaction",
    }));
}
