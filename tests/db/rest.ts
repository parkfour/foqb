import { createHmac } from "node:crypto";
import { inject } from "vitest";
import type { Client } from "pg";
import { PostgrestClient } from "@supabase/postgrest-js";
import type { SupabaseClient } from "@supabase/supabase-js";

const base64url = (value: string | Buffer) => Buffer.from(value).toString("base64url");

// A token PostgREST accepts for this user, as Supabase Auth would issue.
function signedToken(userId: string): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({ sub: userId, role: "authenticated", aal: "aal1", exp: Math.floor(Date.now() / 1000) + 3600 }),
  );
  const signature = createHmac("sha256", inject("jwtSecret")).update(`${header}.${payload}`).digest();
  return `${header}.${payload}.${base64url(signature)}`;
}

// The database as app code sees it through supabase-js (.from, .rpc), signed
// in as `userId` so RLS applies. Requests commit: unlike the pg client's
// per-test transactions, nothing here is rolled back, so a test works in an
// organization of its own.
export function restClientAs(userId: string): SupabaseClient {
  return new PostgrestClient(inject("restUrl"), {
    headers: { Authorization: `Bearer ${signedToken(userId)}` },
  }) as unknown as SupabaseClient;
}

// Removes books made through the API (whose writes committed) the way the
// app removes a book: delete_organization, as the seed user (the first, so
// the Site Admin). Then their users.
export async function removeBooks(client: Client, orgIds: string[], userIds: string[]): Promise<void> {
  await client.query("BEGIN");
  try {
    const { rows } = await client.query("select id from auth.users where email = 'seed@example.com'");
    await client.query(`SET LOCAL request.jwt.claim.sub = '${rows[0].id}'`);
    for (const orgId of orgIds) await client.query("select delete_organization($1)", [orgId]);
    await client.query("delete from auth.users where id = any($1::uuid[])", [userIds]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
