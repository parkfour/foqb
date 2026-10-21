#!/usr/bin/env bash
# Proves a backup from backup-db.sh actually restores: decrypts it, restores
# it into a throwaway, empty local Supabase project, and checks the result.
# Run monthly (or after changing the backup setup). Needs Docker, the
# Supabase CLI, psql, and the GPG *private* key for the backup.
#
#   scripts/restore-check.sh ~/foqb-backups/daily/foqb-<stamp>.tar.gz.gpg
#
# The throwaway project uses its own project id and ports (544xx), so it can
# run next to a normal `supabase start` dev stack, and is removed afterwards.
# Also warns if the newest backup (last-success) is more than 36 hours old.

set -euo pipefail

backup="${1:?usage: restore-check.sh <backup .tar.gz.gpg>}"
BACKUP_DIR="${FOQB_BACKUP_DIR:-$HOME/foqb-backups}"

work="$(mktemp -d)"
project="$work/project"
cleanup() {
  if [ -d "$project/supabase" ]; then
    (cd "$project" && supabase stop --no-backup >/dev/null 2>&1) || true
  fi
  rm -rf "$work"
}
trap cleanup EXIT

gpg --batch --decrypt "$backup" | tar -C "$work" -xzf -

# A brand-new, empty project — the same situation as restoring into a
# replacement Supabase project after losing the real one.
mkdir -p "$project"
(cd "$project" && supabase init --force >/dev/null)
sed -i \
  -e 's/^project_id = .*/project_id = "foqb-restore-check"/' \
  -e 's/= 543\([0-9][0-9]\)/= 544\1/' \
  "$project/supabase/config.toml"
# Use the same service image versions as this repo's own Supabase project
# when it has them pinned (supabase/.temp, written by `supabase link` /
# `start`), so the check restores into the production Postgres version and
# reuses already-downloaded images instead of pulling the CLI's defaults.
pins="${FOQB_SUPABASE_TEMP:-$(dirname "$0")/../supabase/.temp}"
mkdir -p "$project/supabase/.temp"
for pin in "$pins"/*-version "$pins"/storage-migration; do
  [ -f "$pin" ] && cp "$pin" "$project/supabase/.temp/"
done

# Only Postgres and Auth (GoTrue creates the auth schema the data goes into).
if ! (cd "$project" && supabase start \
  -x realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor \
  >"$work/start.log" 2>&1); then
  tail -20 "$work/start.log" >&2
  echo "restore-check: couldn't start the throwaway Supabase project" >&2
  exit 1
fi

db="postgresql://postgres:postgres@127.0.0.1:54422/postgres"

# roles.sql only holds settings on Supabase's own built-in roles (FOQB
# defines no roles of its own), which a fresh project already has — and
# some of its statements need superuser, which no Supabase project grants.
# Applied best-effort; anything skipped is reported, not fatal.
psql "$db" --quiet -v ON_ERROR_STOP=0 --file "$work/roles.sql" >/dev/null 2>"$work/roles.err" || true
skipped="$(grep -c 'ERROR' "$work/roles.err" || true)"

# Schema and data must restore completely, in one transaction.
psql "$db" --quiet --single-transaction -v ON_ERROR_STOP=1 \
  --file "$work/schema.sql" \
  --command 'SET session_replication_role = replica' \
  --file "$work/data.sql" >/dev/null

query() { psql "$db" -tAc "$1"; }

orgs="$(query 'select count(*) from public.organizations')"
users="$(query 'select count(*) from auth.users')"
entries="$(query "select count(*) from public.journal_entries where status = 'posted'")"
# Double-entry integrity: across every posted entry, debits equal credits.
imbalance="$(query "select coalesce(sum(jl.debit) - sum(jl.credit), 0)
                    from public.journal_lines jl
                    join public.journal_entries je on je.id = jl.journal_entry_id
                   where je.status = 'posted'")"

echo "restore-check: $(basename "$backup")"
echo "  organizations:          $orgs"
echo "  users:                  $users"
echo "  posted journal entries: $entries"
echo "  debits - credits:       $imbalance"
echo "  built-in role settings skipped: $skipped"

status=0
if [ "$imbalance" != "0" ] && [ "$imbalance" != "0.00" ]; then
  echo "FAIL: restored ledger doesn't balance" >&2
  status=1
fi
if [ "$users" = "0" ]; then
  echo "FAIL: no users restored" >&2
  status=1
fi

if [ -f "$BACKUP_DIR/last-success" ]; then
  last="$(cat "$BACKUP_DIR/last-success")"
  age_hours=$(( ( $(date -u +%s) - $(date -u -d "$last" +%s) ) / 3600 ))
  if [ "$age_hours" -gt 36 ]; then
    echo "WARN: newest backup is ${age_hours}h old (last-success $last) — is the cron job running?" >&2
  fi
fi

[ "$status" = 0 ] && echo "restore-check: OK"
exit "$status"
