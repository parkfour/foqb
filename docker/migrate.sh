#!/bin/sh
# Applies every not-yet-applied migration in /migrations, in order, each in
# its own transaction, recording what ran in foqb_meta.applied_migrations
# (outside `public`, so PostgREST never exposes it). Then tells PostgREST to
# reload its schema cache.
set -eu

export PGHOST=db PGUSER=postgres PGDATABASE=postgres PGPASSWORD="$POSTGRES_PASSWORD"

until pg_isready -q; do sleep 1; done
# GoTrue creates auth.users, which the migrations reference.
until [ "$(psql -tAc "select to_regclass('auth.users') is not null")" = "t" ]; do sleep 1; done

psql -v ON_ERROR_STOP=1 -q <<'SQL'
create schema if not exists foqb_meta;
create table if not exists foqb_meta.applied_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);
SQL

for file in /migrations/*.sql; do
  name=$(basename "$file")
  if [ "$(psql -tAc "select 1 from foqb_meta.applied_migrations where name = '$name'")" = "1" ]; then
    continue
  fi
  echo "applying $name"
  psql -v ON_ERROR_STOP=1 -q -1 -f "$file" \
    -c "insert into foqb_meta.applied_migrations (name) values ('$name')"
done

psql -q -c "notify pgrst, 'reload schema'"
echo "migrations up to date"
