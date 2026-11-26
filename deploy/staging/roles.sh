#!/bin/sh
# Login roles for staging, after migrations (which create the NOLOGIN group roles clinic_app, clinic_auth,
# clinic_vendor, clinic_operator and revoke CONNECT/TEMPORARY from PUBLIC).
# Each login is a member of exactly one group, as assertAppRole requires (src/db/rls/context.ts): no other
# membership, no CREATE/TEMPORARY, owns nothing. Idempotent: passwords are re-set on every deploy.
# Also writes the database half of the dual environment marker (DEC-125): platform_environment = 'staging'.
# Uses node + pg from the migrate image (no psql there). Passwords come only from the environment.
set -eu
: "${DATABASE_URL:?}" "${APP_DB_PASSWORD:?}" "${AUTH_DB_PASSWORD:?}" "${VENDOR_DB_PASSWORD:?}" "${OPERATOR_DB_PASSWORD:?}" "${DEPLOY_ENV:?}"
cd /app/migrate
node --input-type=module -e '
import pg from "pg";
const env = process.env;
if (env.DEPLOY_ENV !== "staging") throw new Error("roles.sh is for DEPLOY_ENV=staging only");
const logins = [
  ["clinic_app_login", "clinic_app", env.APP_DB_PASSWORD],
  ["clinic_auth_login", "clinic_auth", env.AUTH_DB_PASSWORD],
  ["clinic_vendor_login", "clinic_vendor", env.VENDOR_DB_PASSWORD],
  ["clinic_operator_login", "clinic_operator", env.OPERATOR_DB_PASSWORD],
];
const c = new pg.Client({ connectionString: env.DATABASE_URL });
await c.connect();
try {
  await c.query("begin");
  const db = (await c.query("select current_database() as d")).rows[0].d;
  for (const [login, group, password] of logins) {
    if (!password || password.length < 24) throw new Error(`password for ${login} is missing or too short`);
    const exists = (await c.query("select 1 from pg_roles where rolname = $1", [login])).rowCount === 1;
    const q = (s) => c.query(s);
    const lit = (await c.query("select quote_literal($1) as l", [password])).rows[0].l;
    await q(`${exists ? "ALTER" : "CREATE"} ROLE ${login} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${lit}`);
    // Exactly one group: revoke any other membership a previous run might have left.
    const others = (await c.query(
      "select g.rolname from pg_auth_members m join pg_roles g on g.oid = m.roleid join pg_roles u on u.oid = m.member where u.rolname = $1 and g.rolname <> $2",
      [login, group])).rows;
    for (const o of others) await q(`REVOKE ${o.rolname} FROM ${login}`);
    await q(`GRANT ${group} TO ${login}`);
    await q(`GRANT CONNECT ON DATABASE ${db} TO ${login}`);
    console.log(`  ${login}: member of ${group} only`);
  }
  await c.query(
    "insert into public.platform_environment (id, deploy_env, set_at) values (1, $1, clock_timestamp()) on conflict (id) do update set deploy_env = excluded.deploy_env, set_at = clock_timestamp()",
    [env.DEPLOY_ENV]);
  console.log(`  platform_environment = ${env.DEPLOY_ENV}`);
  await c.query("commit");
} catch (e) {
  await c.query("rollback").catch(() => {});
  throw e;
} finally {
  await c.end();
}
'
