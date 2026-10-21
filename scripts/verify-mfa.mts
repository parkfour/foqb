// End-to-end check that a user with a verified TOTP factor gets nothing
// until their session reaches AAL2 — against a REAL Supabase (auth server,
// PostgREST, auth.mfa_factors, JWT aal claim) plus the real Next.js app,
// which the DB test suite can only stub.
//
// Needs Docker and the Supabase CLI. Run from the repo root:
//   supabase start          # applies every migration
//   node scripts/verify-mfa.mts
//
// Starts its own `next dev` on port 3100 pointed at the local stack, creates
// throwaway users/orgs (left behind — the local stack is disposable), and
// exits non-zero if any check fails.

import { execFileSync, spawn } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { POLICY_VERSION } from "../lib/legal/policy-version.ts";

const APP_PORT = 3100;
const APP_URL = `http://localhost:${APP_PORT}`;

const status = JSON.parse(execFileSync("supabase", ["status", "-o", "json"], { encoding: "utf8" }));
const SUPABASE_URL: string = status.API_URL;
const ANON_KEY: string = status.ANON_KEY;
const SERVICE_KEY: string = status.SERVICE_ROLE_KEY;

// RFC 6238 TOTP (SHA-1, 6 digits, 30s) from the base32 secret Supabase
// returns at enrollment — stands in for an authenticator app.
function totp(secretBase32: string, offsetSteps = 0): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of secretBase32.replace(/=+$/, "").toUpperCase()) {
    bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  }
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + offsetSteps));
  const hmac = createHmac("sha1", key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, "0");
}

// A session held the way the app's server client holds it — in cookies —
// so the same session can query PostgREST directly AND call the Next app.
function cookieSession() {
  const jar = new Map<string, string>();
  const client = createServerClient(SUPABASE_URL, ANON_KEY, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const { name, value } of cookies) {
          if (value) jar.set(name, value);
          else jar.delete(name);
        }
      },
    },
  });
  const cookieHeader = () => [...jar].map(([n, v]) => `${n}=${v}`).join("; ");
  return { client, cookieHeader };
}

const results: { check: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail: string) {
  results.push({ check: name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  (${detail})`);
}

async function probe(label: string, client: SupabaseClient, cookieHeader: () => string, orgId: string, expectAccess: boolean) {
  const { data: accounts, error: accountsError } = await client.from("accounts").select("id").eq("organization_id", orgId);
  const seen = accounts?.length ?? 0;
  check(`${label}: PostgREST select accounts`, expectAccess ? seen === 1 : seen === 0, `${seen} rows${accountsError ? `, ${accountsError.message}` : ""}`);

  const { data: members } = await client.rpc("get_org_members", { p_org_id: orgId });
  const memberCount = (members as unknown[] | null)?.length ?? 0;
  check(`${label}: rpc get_org_members`, expectAccess ? memberCount === 1 : memberCount === 0, `${memberCount} rows`);

  const { error: insertError } = await client
    .from("journal_entries")
    .insert({ organization_id: orgId, entry_date: "2026-09-29", memo: "mfa probe", status: "draft" });
  check(`${label}: insert journal entry`, expectAccess ? !insertError : !!insertError, insertError ? insertError.message : "inserted");

  const api = await fetch(`${APP_URL}/api/export/organization`, { headers: { cookie: cookieHeader() }, redirect: "manual" });
  check(`${label}: GET /api/export/organization`, expectAccess ? api.status === 200 : api.status === 401, `HTTP ${api.status}`);

  const page = await fetch(`${APP_URL}/`, { headers: { cookie: cookieHeader() }, redirect: "manual" });
  const location = page.headers.get("location") ?? "";
  check(
    `${label}: GET / (dashboard)`,
    expectAccess ? page.status === 200 : location.endsWith("/login/mfa"),
    `HTTP ${page.status}${location ? ` -> ${location}` : ""}`,
  );
}

async function createUserWithOrg(admin: SupabaseClient, email: string, password: string) {
  const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !created.user) throw new Error(`createUser: ${error?.message}`);
  const orgId = randomUUID();
  for (const [table, row] of [
    ["organizations", { id: orgId, name: `MFA probe ${email}` }],
    ["organization_members", { organization_id: orgId, user_id: created.user.id, role: "owner" }],
    ["accounts", { organization_id: orgId, account_number: "1000", name: "Checking", type: "asset" }],
    // Already agreed to the current policies, so the page checks below test
    // MFA rather than landing on /accept-terms.
    ["policy_acceptances", { user_id: created.user.id, version: POLICY_VERSION }],
  ] as const) {
    const { error: insertError } = await admin.from(table).insert(row);
    if (insertError) throw new Error(`${table}: ${insertError.message}`);
  }
  return orgId;
}

async function waitForApp() {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      await fetch(`${APP_URL}/welcome`, { redirect: "manual" });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error("next dev did not come up");
}

async function main() {
  const app = spawn("npx", ["next", "dev", "-p", String(APP_PORT)], {
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
      ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      ALLOWED_PROXY_IP: "",
    },
    stdio: "ignore",
    detached: true,
  });

  try {
    await waitForApp();
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const password = `Pw-${randomUUID()}`;
    const run = Date.now();

    // --- Enrolled user -------------------------------------------------
    const enrolledEmail = `mfa-enrolled-${run}@example.com`;
    const enrolledOrg = await createUserWithOrg(admin, enrolledEmail, password);

    const setup = cookieSession();
    await setup.client.auth.signInWithPassword({ email: enrolledEmail, password });
    const { data: factor, error: enrollError } = await setup.client.auth.mfa.enroll({ factorType: "totp" });
    if (enrollError || !factor) throw new Error(`enroll: ${enrollError?.message}`);
    const secret = factor.totp.secret;
    const { error: verifyError } = await setup.client.auth.mfa.challengeAndVerify({ factorId: factor.id, code: totp(secret) });
    if (verifyError) throw new Error(`verify enrollment: ${verifyError.message}`);

    // Fresh password-only sign-in: AAL1 with a verified factor on file.
    const session = cookieSession();
    await session.client.auth.signInWithPassword({ email: enrolledEmail, password });
    const { data: aal1 } = await session.client.auth.mfa.getAuthenticatorAssuranceLevel();
    check("enrolled user signs in at aal1, needs aal2", aal1?.currentLevel === "aal1" && aal1?.nextLevel === "aal2", `${aal1?.currentLevel} -> ${aal1?.nextLevel}`);
    await probe("enrolled @ aal1", session.client, session.cookieHeader, enrolledOrg, false);

    // Pass the challenge. Supabase rejects reusing the enrollment's code,
    // so wait for the next 30s window if we're still in it.
    await new Promise((r) => setTimeout(r, 30_000 - (Date.now() % 30_000) + 500));
    const { error: challengeError } = await session.client.auth.mfa.challengeAndVerify({ factorId: factor.id, code: totp(secret) });
    if (challengeError) throw new Error(`challenge: ${challengeError.message}`);
    const { data: aal2 } = await session.client.auth.mfa.getAuthenticatorAssuranceLevel();
    check("enrolled user reaches aal2 after challenge", aal2?.currentLevel === "aal2", `${aal2?.currentLevel}`);
    await probe("enrolled @ aal2", session.client, session.cookieHeader, enrolledOrg, true);

    // --- User without MFA: must be unaffected ----------------------------
    const plainEmail = `mfa-none-${run}@example.com`;
    const plainOrg = await createUserWithOrg(admin, plainEmail, password);
    const plain = cookieSession();
    await plain.client.auth.signInWithPassword({ email: plainEmail, password });
    await probe("no factor @ aal1", plain.client, plain.cookieHeader, plainOrg, true);
  } finally {
    if (app.pid) process.kill(-app.pid, "SIGTERM");
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
