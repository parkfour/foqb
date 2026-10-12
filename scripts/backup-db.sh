#!/usr/bin/env bash
# Nightly encrypted backup of the FOQB Supabase database (for projects on a
# plan without Supabase-managed backups). Run from cron on an always-on
# machine; see docs/SELF_HOSTING.md "Database backups".
#
# Dumps roles, schema and data separately with `supabase db dump` (Supabase's
# documented backup/restore path — pg_dump runs in Supabase's own image, so
# its version always matches the server), tars them, encrypts the tarball to
# a GPG public key, and keeps the newest N daily + M weekly copies.
#
# Settings (environment, or the env file below):
#   FOQB_DB_URL                session-pooler connection string, percent-encoded
#   FOQB_BACKUP_GPG_RECIPIENT  GPG key id/email to encrypt to (public key only
#                              needs to be on this machine)
#   FOQB_BACKUP_DIR            default ~/foqb-backups
#   FOQB_BACKUP_KEEP_DAILY     default 14
#   FOQB_BACKUP_KEEP_WEEKLY    default 8   (Sunday's backup is also kept weekly)
#
# Exits non-zero on any failure, so cron's mail (if configured) reports it;
# writes $FOQB_BACKUP_DIR/last-success on success for monitoring.

set -euo pipefail

ENV_FILE="${FOQB_BACKUP_ENV:-$HOME/.config/foqb-backup.env}"
# shellcheck disable=SC1090
[ -f "$ENV_FILE" ] && . "$ENV_FILE"

: "${FOQB_DB_URL:?set FOQB_DB_URL (Supabase session pooler connection string)}"
: "${FOQB_BACKUP_GPG_RECIPIENT:?set FOQB_BACKUP_GPG_RECIPIENT (GPG key to encrypt to)}"
BACKUP_DIR="${FOQB_BACKUP_DIR:-$HOME/foqb-backups}"
KEEP_DAILY="${FOQB_BACKUP_KEEP_DAILY:-14}"
KEEP_WEEKLY="${FOQB_BACKUP_KEEP_WEEKLY:-8}"

umask 077
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

supabase db dump --db-url "$FOQB_DB_URL" --role-only -f "$work/roles.sql"
supabase db dump --db-url "$FOQB_DB_URL" -f "$work/schema.sql"
# Supabase Storage's own tables are left out: FOQB keeps no files there (the
# org logo is stored in the database), and a fresh project won't accept
# writes to several of them — Supabase's documented restore excludes them too.
supabase db dump --db-url "$FOQB_DB_URL" --data-only --use-copy -f "$work/data.sql" \
  -x storage.buckets,storage.buckets_analytics,storage.buckets_vectors,storage.iceberg_namespaces,storage.iceberg_tables,storage.objects,storage.vector_indexes

# A dump that "succeeded" but is missing the app's tables or its users is
# worse than a failure — refuse to rotate older good backups out for it.
grep -q 'CREATE TABLE IF NOT EXISTS "public"."journal_entries"' "$work/schema.sql" \
  || { echo "backup-db: schema dump has no public.journal_entries" >&2; exit 1; }
grep -q '^COPY "auth"."users"' "$work/data.sql" \
  || { echo "backup-db: data dump has no auth.users" >&2; exit 1; }

mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/weekly"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="$BACKUP_DIR/daily/foqb-$stamp.tar.gz.gpg"

tar -C "$work" -czf - roles.sql schema.sql data.sql \
  | gpg --batch --yes --trust-model always --encrypt \
      --recipient "$FOQB_BACKUP_GPG_RECIPIENT" --output "$out.partial"
mv "$out.partial" "$out"

if [ "$(date -u +%u)" = 7 ]; then
  cp "$out" "$BACKUP_DIR/weekly/"
fi

prune() {
  # Newest first; delete everything past the first $2.
  find "$1" -maxdepth 1 -name 'foqb-*.tar.gz.gpg' -printf '%T@ %p\n' \
    | sort -rn | tail -n +"$(( $2 + 1 ))" | cut -d' ' -f2- | xargs -r rm -f --
}
prune "$BACKUP_DIR/daily" "$KEEP_DAILY"
prune "$BACKUP_DIR/weekly" "$KEEP_WEEKLY"

date -u +%Y-%m-%dT%H:%M:%SZ > "$BACKUP_DIR/last-success"
echo "backup-db: wrote $out ($(du -h "$out" | cut -f1))"
