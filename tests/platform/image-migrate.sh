#!/usr/bin/env bash
# Builds the release image, runs its migration entry point against a throwaway database
# and checks the image: non-root, no .env, migrations applied. Needs Docker and the
# local Compose PostgreSQL (or ADMIN_URL pointing at a disposable server).
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
admin="${ADMIN_URL:-postgres://clinic:clinic_local_only@127.0.0.1:5432/postgres}"
db="img_$(date +%s)_$$"
image="clinic-dashboard:image-check-$$"
pg() { docker run --rm --network host postgres:16.15-bookworm psql "$1" -v ON_ERROR_STOP=1 -qtAc "$2"; }
cleanup() {
  pg "$admin" "drop database if exists $db with (force)" >/dev/null 2>&1 || true
  docker image rm "$image" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker build -q -t "$image" "$root" >/dev/null
pg "$admin" "create database $db" >/dev/null
# Replace the database name, keeping any ?query (e.g. sslmode).
base="${admin%%\?*}"; query="${admin#"$base"}"
url="${base%/*}/$db$query"
docker run --rm --network host -e "DATABASE_URL=$url" "$image" \
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON /app/migrate/src/db/migrate.ts
applied="$(pg "$url" "select count(*) from drizzle.__drizzle_migrations")"
expected="$(ls "$root"/drizzle/*.sql | wc -l)"
[ "$applied" = "$expected" ] || { echo "applied $applied of $expected migrations" >&2; exit 1; }
[ "$(docker run --rm --entrypoint id "$image" -u)" != "0" ] || { echo "image runs as root" >&2; exit 1; }
if docker run --rm --entrypoint sh "$image" -c 'touch /app/migrate/drizzle/x 2>/dev/null'; then
  echo "migration files are writable by the runtime user" >&2; exit 1
fi
if docker run --rm --entrypoint sh "$image" -c 'find / -xdev -name ".env*" -not -path "/proc/*" 2>/dev/null | grep -q .'; then
  echo ".env found in image" >&2; exit 1
fi
echo "IMAGE CHECK PASSED ($applied migrations)"
