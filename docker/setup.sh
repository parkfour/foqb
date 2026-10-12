#!/bin/sh
# Writes .env for docker/compose.yml with freshly generated secrets: the
# Postgres password, the JWT secret and the anon/service-role keys signed
# with it, and the bank-token encryption key. Never overwrites an existing
# .env (that would orphan the data encrypted under the old keys).
#
#   docker/setup.sh https://books.example.com > /dev/null
#
# Plaid and legal settings are left for you to fill in (see .env.example).
set -eu
cd "$(dirname "$0")"

site_url=${1:?usage: setup.sh <public site URL, e.g. https://books.example.com>}
if [ -e .env ]; then
  echo "setup.sh: .env already exists; not overwriting it" >&2
  exit 1
fi

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

jwt_secret=$(openssl rand -hex 32)
jwt() {
  header=$(printf '{"alg":"HS256","typ":"JWT"}' | b64url)
  now=$(date +%s)
  payload=$(printf '{"role":"%s","iss":"supabase","iat":%s,"exp":%s}' "$1" "$now" $((now + 10 * 365 * 24 * 3600)) | b64url)
  sig=$(printf '%s.%s' "$header" "$payload" | openssl dgst -sha256 -hmac "$jwt_secret" -binary | b64url)
  printf '%s.%s.%s' "$header" "$payload" "$sig"
}

umask 077
cat > .env <<ENV
SITE_URL=$site_url
POSTGRES_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$jwt_secret
ANON_KEY=$(jwt anon)
SERVICE_ROLE_KEY=$(jwt service_role)
ENCRYPTION_KEY=$(openssl rand -base64 32)
APP_PORT=8090

# Bank sync (optional): from your Plaid Dashboard's Keys page.
PLAID_CLIENT_ID=
PLAID_SECRET=
PLAID_ENV=sandbox

# Who runs this instance, for /privacy, /terms and /security (all or none).
LEGAL_OPERATOR_NAME=
LEGAL_CONTACT_EMAIL=
LEGAL_JURISDICTION=

# 1 = public demo: shows a banner saying data is wiped, hides password reset.
DEMO_MODE=
ENV
echo "wrote $(pwd)/.env" >&2
