#!/usr/bin/env bash
# Writes /etc/pgbackrest/pgbackrest.conf from environment (ARCH-9: every target is
# configuration) and starts PostgreSQL with WAL archiving to the pgBackRest repository.
#
# Required:  PGBACKREST_STANZA, PGBACKREST_REPO1_CIPHER_PASS (repository encryption, SEC-11)
# Repository (one of):
#   posix: PGBACKREST_REPO1_PATH (default /var/lib/pgbackrest)
#   s3:    PGBACKREST_REPO1_TYPE=s3, PGBACKREST_REPO1_S3_BUCKET, _S3_ENDPOINT, _S3_REGION,
#          _S3_KEY, _S3_KEY_SECRET, optional _S3_URI_STYLE (path|host)
# Optional:  PGBACKREST_REPO1_RETENTION_FULL (default 4)
set -euo pipefail

: "${PGBACKREST_STANZA:?PGBACKREST_STANZA is required}"
: "${PGBACKREST_REPO1_CIPHER_PASS:?PGBACKREST_REPO1_CIPHER_PASS is required (encrypted repository)}"
repo_type="${PGBACKREST_REPO1_TYPE:-posix}"

# Values end up in the config file and in archive_command: refuse anything that could
# add a line or an option.
[[ "$PGBACKREST_STANZA" =~ ^[a-z0-9_-]+$ ]] || { echo "PGBACKREST_STANZA must match [a-z0-9_-]+" >&2; exit 1; }
for v in PGBACKREST_REPO1_TYPE PGBACKREST_REPO1_PATH PGBACKREST_REPO1_RETENTION_FULL \
         PGBACKREST_REPO1_S3_BUCKET PGBACKREST_REPO1_S3_ENDPOINT PGBACKREST_REPO1_S3_REGION \
         PGBACKREST_REPO1_S3_URI_STYLE PGDATA; do
  val="${!v:-}"
  if [[ "$val" == *$'\n'* || "$val" == *$'\r'* ]]; then
    echo "$v contains a newline" >&2
    exit 1
  fi
done

conf=/etc/pgbackrest/pgbackrest.conf
install -d -m 0750 -o postgres -g postgres /etc/pgbackrest
{
  echo "[global]"
  echo "repo1-type=${repo_type}"
  echo "repo1-cipher-type=aes-256-cbc"
  echo "repo1-retention-full=${PGBACKREST_REPO1_RETENTION_FULL:-4}"
  echo "start-fast=y"
  echo "archive-async=y"
  echo "spool-path=/var/spool/pgbackrest"
  echo "log-level-console=info"
  echo "log-level-file=off"
  case "$repo_type" in
    posix) echo "repo1-path=${PGBACKREST_REPO1_PATH:-/var/lib/pgbackrest}" ;;
    s3)
      echo "repo1-path=${PGBACKREST_REPO1_PATH:-/pgbackrest}"
      echo "repo1-s3-bucket=${PGBACKREST_REPO1_S3_BUCKET:?}"
      echo "repo1-s3-endpoint=${PGBACKREST_REPO1_S3_ENDPOINT:?}"
      echo "repo1-s3-region=${PGBACKREST_REPO1_S3_REGION:?}"
      echo "repo1-s3-uri-style=${PGBACKREST_REPO1_S3_URI_STYLE:-host}"
      ;;
    *) echo "unsupported PGBACKREST_REPO1_TYPE=${repo_type}" >&2; exit 1 ;;
  esac
  echo
  echo "[${PGBACKREST_STANZA}]"
  echo "pg1-path=${PGDATA:-/var/lib/postgresql/data}"
} > "$conf"
chown postgres:postgres "$conf"
chmod 0640 "$conf"
# Secrets stay in the environment (pgBackRest reads PGBACKREST_REPO1_CIPHER_PASS and
# PGBACKREST_REPO1_S3_KEY[_SECRET] directly); they are never written to the file.

# A restored instance sets PGBACKREST_ARCHIVE=off so it never pushes WAL into the
# repository it was restored from (drills and staging restores).
if [ "${1:-}" = "postgres" ] && [ "${PGBACKREST_ARCHIVE:-on}" = "off" ]; then
  set -- "$@" -c archive_mode=off
elif [ "${1:-}" = "postgres" ]; then
  set -- "$@" \
    -c archive_mode=on \
    -c "archive_command=pgbackrest --stanza=${PGBACKREST_STANZA} archive-push %p" \
    -c archive_timeout=60 \
    -c wal_level=replica \
    -c max_wal_senders=3
fi
exec docker-entrypoint.sh "$@"
