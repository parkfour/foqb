#!/bin/sh
# For a public demo: throws away the database (every account and
# organization) and starts over from the migrations, with whatever app
# image is newest. Run from cron, e.g. every 6 hours:
#   0 */6 * * * /path/to/docker/reset-demo.sh >> /path/to/reset.log 2>&1
set -eu
cd "$(dirname "$0")"
echo "$(date -u +%FT%TZ) resetting"
docker compose down --volumes --remove-orphans
docker compose up -d --wait
# The first account on a fresh instance becomes its Site Admin. Use that up
# on an account nobody can sign in to (no password), so no visitor gets the
# Site Admin console.
docker compose exec -T db psql -U postgres -q -c \
  "insert into auth.users (id, aud, role, email) values (gen_random_uuid(), 'authenticated', 'authenticated', 'site-admin@demo.invalid')"
echo "$(date -u +%FT%TZ) done"
