#!/usr/bin/env bash
# Restore drill (DR-1, DR-2, T-005): seed a source database with synthetic rows, take a
# full encrypted pgBackRest backup, write more rows after the backup, then restore the
# repository into a scratch PostgreSQL instance (archiving off) and compare row counts
# and content checksums per table, which proves base backup plus WAL replay. Uses throwaway containers, a throwaway volume and a
# random cipher passphrase; nothing is kept. Local use and CI only: never point it at
# a real repository.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
id="drill-$(date +%s)-$$"
image="clinic-pgbackrest:drill"
net="$id-net"
repo="$id-repo"
src="$id-src"
dst="$id-dst"
pass="$(head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 40)"
env=(-e POSTGRES_PASSWORD=drill -e PGBACKREST_STANZA=clinic -e "PGBACKREST_REPO1_CIPHER_PASS=$pass")

cleanup() {
  docker rm -f -v "$src" "$dst" >/dev/null 2>&1 || true # -v: their anonymous data volumes
  docker volume rm "$repo" >/dev/null 2>&1 || true
  docker image rm "$image" >/dev/null 2>&1 || true
  docker network rm "$net" >/dev/null 2>&1 || true
}
trap cleanup EXIT

psql_in() { docker exec -i -u postgres "$1" psql -v ON_ERROR_STOP=1 -qAt -d clinic_dashboard "${@:2}"; }
wait_ready() {
  for _ in $(seq 1 120); do
    if docker exec -u postgres "$1" pg_isready -q -d clinic_dashboard 2>/dev/null &&
       docker exec -u postgres "$1" psql -qAt -d clinic_dashboard -c 'select 1' >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done
  docker logs "$1" | tail -20 >&2
  return 1
}

docker build -q -t "$image" "$here" >/dev/null
docker network create "$net" >/dev/null
docker volume create "$repo" >/dev/null

echo "== source: start, migrate, seed"
docker run -d --name "$src" --network "$net" "${env[@]}" -e POSTGRES_DB=clinic_dashboard \
  -v "$repo:/var/lib/pgbackrest" "$image" >/dev/null
wait_ready "$src"
src_ip="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$src")"
port_url="postgres://postgres:drill@${src_ip}:5432/clinic_dashboard"
docker run --rm --network "$net" -v "$root:/app:ro" -w /app -e "DATABASE_URL=$port_url" \
  node:26.13.0-bookworm-slim node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON src/db/migrate.ts >/dev/null

seed() { # $1 = number of synthetic tenants, each with 3 branches
  psql_in "$src" <<SQL
insert into tenants_registry (lifecycle_state) select 'provisioning' from generate_series(1, $1);
insert into tenants (id, legal_name, sak_framework)
  select r.id, 'PT Sintetis ' || r.id, 'emkm' from tenants_registry r
  where not exists (select 1 from tenants t where t.id = r.id);
insert into branches (tenant_id, code, name, timezone)
  select t.id, 'CAB' || g, 'Cabang ' || g, 'Asia/Jakarta' from tenants t, generate_series(1, 3) g
  where not exists (select 1 from branches b where b.tenant_id = t.id);
SQL
}
seed 25

echo "== backup: stanza, check, full backup"
docker exec -u postgres "$src" pgbackrest --stanza=clinic stanza-create >/dev/null
docker exec -u postgres "$src" pgbackrest --stanza=clinic check >/dev/null
docker exec -u postgres "$src" pgbackrest --stanza=clinic --type=full backup >/dev/null

echo "== after backup: more rows, archived through WAL only"
seed 10
psql_in "$src" -c "select pg_switch_wal()" >/dev/null
docker exec -u postgres "$src" pgbackrest --stanza=clinic check >/dev/null # waits for the WAL push

# Row count plus an order-independent content checksum per table.
counts_sql="select t, n, md5(h) from (
    select 'tenants_registry' t, count(*) n, string_agg(md5(r::text), '' order by md5(r::text)) h from tenants_registry r
    union all select 'tenants', count(*), string_agg(md5(r::text), '' order by md5(r::text)) from tenants r
    union all select 'branches', count(*), string_agg(md5(r::text), '' order by md5(r::text)) from branches r
    union all select 'scope_map', count(*), string_agg(md5(r::text), '' order by md5(r::text)) from scope_map r
    union all select 'migrations', count(*), string_agg(md5(r::text), '' order by md5(r::text)) from drizzle.__drizzle_migrations r
  ) x order by 1"
expected="$(psql_in "$src" -c "$counts_sql")"
docker stop "$src" >/dev/null

echo "== restore into a scratch instance"
docker run -d --name "$dst" --network "$net" "${env[@]}" -v "$repo:/var/lib/pgbackrest" \
  --entrypoint bash "$image" -c 'sleep infinity' >/dev/null
docker exec "$dst" bash -c '
  set -e
  /usr/local/bin/entrypoint-pgbackrest.sh true
  install -d -o postgres -g postgres -m 0700 "$PGDATA"
  su postgres -c "pgbackrest --stanza=clinic --type=default restore"
' >/dev/null
docker exec -d -e PGBACKREST_ARCHIVE=off "$dst" /usr/local/bin/entrypoint-pgbackrest.sh postgres
wait_ready "$dst"
actual="$(psql_in "$dst" -c "$counts_sql")"

echo "expected:"; echo "$expected"
echo "restored:"; echo "$actual"
if [ "$expected" != "$actual" ]; then
  echo "RESTORE DRILL FAILED: row counts or contents differ" >&2
  exit 1
fi
if ! grep -q '^tenants|35|' <<<"$actual"; then
  echo "RESTORE DRILL FAILED: rows written after the backup were not replayed" >&2
  exit 1
fi
echo "RESTORE DRILL PASSED"
