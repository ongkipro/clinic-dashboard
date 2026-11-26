#!/bin/sh
# Staging migrate step: apply migrations as the owner role, then create the login roles and set the database's
# environment marker. Exits non-zero on any failure, so "app" never starts on a half-prepared database.
set -eu
echo "migrate: applying migrations"
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON /app/migrate/src/db/migrate.ts
echo "migrate: login roles and environment marker"
sh /app/deploy/roles.sh
echo "migrate: done"
