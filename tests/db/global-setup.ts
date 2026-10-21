import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import type { TestProject } from "vitest/node";

const CONTAINER_NAME = "foqb-test-db";
const HOST_PORT = 55432;

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

create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create or replace function auth.jwt() returns jsonb
language sql stable
as $$
  select jsonb_build_object(
    'sub', nullif(current_setting('request.jwt.claim.sub', true), ''),
    'email', nullif(current_setting('request.jwt.claim.email', true), ''),
    'aal', nullif(current_setting('request.jwt.claim.aal', true), '')
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
end
$$;

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
    runArgs.push("-p", `${HOST_PORT}:5432`);
  }
  runArgs.push("postgres:16-alpine");

  execFileSync("docker", runArgs);

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
  } catch (error) {
    spawnSync("docker", ["rm", "-f", CONTAINER_NAME], { stdio: "ignore" });
    throw error;
  }

  project.provide("databaseUrl", connectionString);

  return async () => {
    spawnSync("docker", ["rm", "-f", CONTAINER_NAME], { stdio: "ignore" });
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}
