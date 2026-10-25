import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import type { TestProject } from "vitest/node";

// CI jobs running at once share the host's docker daemon, so inside a job
// container the names carry that container's hostname: otherwise one job's
// setup removes the other's database.
const NAME_SUFFIX = isRunningInContainer() ? `-${os.hostname()}` : "";
const CONTAINER_NAME = `foqb-test-db${NAME_SUFFIX}`;
const HOST_PORT = 55432;
// PostgREST, the API Supabase puts in front of the database, for tests of
// code that talks to it through supabase-js (tests/db/rest.ts). It shares
// the database container's network, so it's on the same localhost.
const REST_CONTAINER_NAME = `foqb-test-rest${NAME_SUFFIX}`;
const REST_PORT = 55433;
// Docker Hub's, like postgres:16-alpine and the demo's (docker/compose.yml):
// AWS's public registry throttles anonymous pulls on a fresh CI runner.
const REST_IMAGE = "postgrest/postgrest:v14.5";
const JWT_SECRET = "foqb-test-jwt-secret-at-least-32-characters";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(rootDir, "../../supabase/migrations");

// Minimal stand-in for the parts of Supabase's platform schema our
// migrations depend on: the auth.users table (FK target) and auth.uid()
// (read by RLS policies), plus a non-superuser `authenticated` role so RLS
// actually applies (table owners/superusers bypass RLS by default).
const AUTH_STUB_SQL = `
create extension if not exists pgcrypto;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  last_sign_in_at timestamptz,
  created_at timestamptz not null default now()
);

-- Tests set request.jwt.claim.* directly (asUser); PostgREST sets the
-- request.jwt.claims JSON, as Supabase's own auth.uid() reads.
create or replace function auth.uid() returns uuid
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;

create or replace function auth.jwt() returns jsonb
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    jsonb_build_object(
      'sub', nullif(current_setting('request.jwt.claim.sub', true), ''),
      'email', nullif(current_setting('request.jwt.claim.email', true), ''),
      'aal', nullif(current_setting('request.jwt.claim.aal', true), '')
    )
  )
$$;

create table if not exists auth.mfa_factors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  factor_type text not null default 'totp',
  status text not null default 'verified'
);

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  -- Supabase's real service_role has BYPASSRLS and broad default
  -- privileges platform-wide; migrations that grant to it (see
  -- check_rate_limit) need the role to exist here too.
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  -- PostgREST logs in as this and switches to the request's role.
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login password 'postgres' noinherit;
  end if;
end
$$;

grant anon, authenticated, service_role to authenticator;

grant usage on schema public to authenticated;
grant usage on schema auth to authenticated;
grant usage on schema public to service_role;
grant usage on schema public to anon;

-- Supabase grants EXECUTE on every new public function to anon and
-- authenticated by default; mirror that so a migration's REVOKE is
-- actually exercised (and not masked by a blanket grant afterwards).
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

const GRANTS_SQL = `
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
`;

function runPsql(connectionString: string, sql: string): void {
  const result = spawnSync("psql", [connectionString, "-v", "ON_ERROR_STOP=1", "-q"], {
    input: sql,
    encoding: "utf-8",
  });

  if (result.status !== 0) {
    // result.error (e.g. ENOENT when the psql binary is missing) has no
    // stderr, so surface it explicitly instead of throwing "undefined".
    throw new Error(`psql failed: ${result.error?.message ?? result.stderr}`);
  }
}

function runPsqlFile(connectionString: string, filePath: string): void {
  const result = spawnSync(
    "psql",
    [connectionString, "-v", "ON_ERROR_STOP=1", "-q", "-f", filePath],
    { encoding: "utf-8" },
  );

  if (result.status !== 0) {
    throw new Error(`psql failed on ${filePath}: ${result.error?.message ?? result.stderr}`);
  }
}

async function waitForPostgres(connectionString: string): Promise<void> {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    const client = new Client({ connectionString });
    try {
      await client.connect();
      await client.end();
      return;
    } catch {
      await client.end().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  throw new Error("Postgres test container did not become ready in time");
}

// Some CI runners (e.g. this Gitea act_runner) execute the job itself
// inside a container that has the host's docker.sock mounted in, and put
// that job container on its own dedicated per-job bridge network. A
// sibling `docker run` with no --network lands on the default bridge —
// a different network the job container was never attached to — so
// neither localhost:HOST_PORT nor the sibling's own bridge IP is
// reachable from inside the job container. /.dockerenv marks that we're
// running inside a container at all; when we are, join the Postgres
// container to *our own* network namespace (`--network container:<us>`)
// so its port lands on our own localhost, the way `-p` would on a plain
// host.
function isRunningInContainer(): boolean {
  return existsSync("/.dockerenv");
}

export default async function setup(project: TestProject) {
  spawnSync("docker", ["rm", "-f", CONTAINER_NAME], { stdio: "ignore" });

  const nested = isRunningInContainer();

  const runArgs = ["run", "-d", "--name", CONTAINER_NAME, "-e", "POSTGRES_PASSWORD=postgres"];
  if (nested) {
    runArgs.push("--network", `container:${os.hostname()}`);
  } else {
    runArgs.push("-p", `${HOST_PORT}:5432`, "-p", `${REST_PORT}:${REST_PORT}`);
  }
  runArgs.push("postgres:16-alpine");

  execFileSync("docker", runArgs);

  const restUrl = `http://localhost:${REST_PORT}`;
  const connectionString = nested
    ? "postgresql://postgres:postgres@localhost:5432/postgres"
    : `postgresql://postgres:postgres@localhost:${HOST_PORT}/postgres`;

  try {
    await waitForPostgres(connectionString);

    runPsql(connectionString, AUTH_STUB_SQL);

    const migrationFiles = readdirSync(migrationsDir)
      .filter((file) => file.endsWith(".sql"))
      .sort();

    for (const file of migrationFiles) {
      runPsqlFile(connectionString, path.join(migrationsDir, file));
    }

    // A real production database already has users by the time this app
    // exists — this seed row mirrors that so ordinary tests' "first user
    // created in this transaction" doesn't accidentally trip the
    // first-user-becomes-Site-Admin bootstrap trigger. It's inserted once,
    // committed here (not per-test, so it isn't rolled back), and is
    // already visible to every test's own transaction. Tests that need to
    // exercise the bootstrap trigger itself delete all auth.users rows
    // first, within their own (later rolled-back) transaction.
    runPsql(connectionString, `insert into auth.users (email) values ('seed@example.com');`);

    runPsql(connectionString, GRANTS_SQL);

    // Started once the schema is in, so its schema cache has it all.
    spawnSync("docker", ["rm", "-f", REST_CONTAINER_NAME], { stdio: "ignore" });
    pullWithRetries(REST_IMAGE);
    execFileSync("docker", [
      "run", "-d", "--name", REST_CONTAINER_NAME,
      "--network", `container:${nested ? os.hostname() : CONTAINER_NAME}`,
      "-e", "PGRST_DB_URI=postgresql://authenticator:postgres@localhost:5432/postgres",
      "-e", "PGRST_DB_SCHEMAS=public",
      "-e", "PGRST_DB_ANON_ROLE=anon",
      "-e", `PGRST_JWT_SECRET=${JWT_SECRET}`,
      "-e", `PGRST_SERVER_PORT=${REST_PORT}`,
      "-e", "PGRST_DB_MAX_ROWS=1000",
      REST_IMAGE,
    ]);
    await waitForRest(restUrl);
  } catch (error) {
    spawnSync("docker", ["rm", "-f", REST_CONTAINER_NAME, CONTAINER_NAME], { stdio: "ignore" });
    throw error;
  }

  project.provide("databaseUrl", connectionString);
  project.provide("restUrl", restUrl);
  project.provide("jwtSecret", JWT_SECRET);

  return async () => {
    spawnSync("docker", ["rm", "-f", REST_CONTAINER_NAME, CONTAINER_NAME], { stdio: "ignore" });
  };
}

// A registry's rate limit or a network blip shouldn't fail the suite.
function pullWithRetries(image: string, attempts = 3): void {
  if (spawnSync("docker", ["image", "inspect", image], { stdio: "ignore" }).status === 0) return;
  for (let attempt = 1; ; attempt++) {
    const result = spawnSync("docker", ["pull", "-q", image], { encoding: "utf-8" });
    if (result.status === 0) return;
    if (attempt >= attempts) throw new Error(`Couldn't pull ${image}: ${result.stderr}`);
    spawnSync("sleep", [String(10 * attempt)]);
  }
}

async function waitForRest(url: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${url}/`)).ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("PostgREST test container did not become ready in time");
}

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
    restUrl: string;
    jwtSecret: string;
  }
}
