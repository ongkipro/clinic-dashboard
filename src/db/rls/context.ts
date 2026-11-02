// TEN-2: the application connects as a LOGIN role that is a member of `clinic_app`
// (no SUPERUSER, no BYPASSRLS, owns nothing, cannot create objects) and binds tenant
// context per transaction on a client it holds exclusively.
import { AsyncLocalStorage } from "node:async_hooks";
import type pg from "pg";

export const APP_GROUP_ROLE = "clinic_app";
// Better Auth's login tables only (T-006); same startup rules, other group.
export const AUTH_GROUP_ROLE = "clinic_auth";
export type GroupRole = typeof APP_GROUP_ROLE | typeof AUTH_GROUP_ROLE;

export class UnsafeDatabaseRoleError extends Error {}

// The TEN-2 context settings. Policies read only these; none may have a session value.
export const CONTEXT_SETTINGS = [
  "app.tenant_id",
  "app.allowed_branch_ids",
  "app.active_branch_id",
  "app.staff_id",
  "app.roles",
] as const;

// Refuses to start when the connection could bypass or reshape RLS. Allow-list: the
// login (session_user) may reach exactly itself and clinic_app, so predefined roles such
// as pg_read_all_data or pg_execute_server_program are refused. Because SET ROLE /
// RESET ROLE can return to any reachable role, every reachable role is checked for
// SUPERUSER, BYPASSRLS, REPLICATION, CREATEROLE/CREATEDB, owning the database, a schema
// or a relation (owners skip RLS), CREATE or TEMPORARY on the database (effective,
// including grants to PUBLIC) or CREATE on a schema, and direct
// privileges on relations, columns, functions or schemas (all access goes through
// clinic_app). A session default for
// any app.* setting is refused because policies must fail closed outside a context.
// Call once per pool at startup.
export async function assertAppRole(
  client: pg.ClientBase,
  group: GroupRole = APP_GROUP_ROLE,
): Promise<void> {
  const { rows } = await client.query<{ role: string; problems: string[] }>(
    `with reachable as (
       select r.oid, r.rolname, r.rolsuper, r.rolbypassrls, r.rolreplication,
              r.rolcreaterole, r.rolcreatedb
       from pg_roles r where pg_has_role(session_user, r.oid, 'MEMBER')
     ),
     user_schemas as (
       select oid, nspowner from pg_namespace
       where nspname not in ('pg_catalog','information_schema')
         and nspname not like 'pg_toast%' and nspname not like 'pg_temp%'
     )
     select session_user::text as role, array_remove(array[
       (select 'member of unexpected role ' || string_agg(rolname, ', ' order by rolname)
          from reachable where rolname not in (session_user, $1)),
       case when exists (select 1 from reachable where rolsuper) then 'superuser' end,
       case when exists (select 1 from reachable where rolbypassrls) then 'bypassrls' end,
       case when exists (select 1 from reachable where rolreplication) then 'replication' end,
       case when exists (select 1 from reachable where rolcreaterole or rolcreatedb)
            then 'createrole/createdb' end,
       case when exists (select 1 from pg_database d join reachable r on r.oid = d.datdba
                         where d.datname = current_database()) then 'owns the database' end,
       case when exists (select 1 from user_schemas s join reachable r on r.oid = s.nspowner)
            then 'owns a schema' end,
       case when exists (select 1 from pg_class c join reachable r on r.oid = c.relowner
                         join user_schemas s on s.oid = c.relnamespace)
            then 'owns relations' end,
       case when exists (select 1 from reachable r
                         where has_database_privilege(r.oid, current_database(), 'CREATE'))
              or exists (select 1 from reachable r
                         where has_database_privilege(r.oid, current_database(), 'TEMPORARY'))
              or exists (select 1 from reachable r cross join user_schemas s
                         where has_schema_privilege(r.oid, s.oid, 'CREATE'))
            then 'can create objects' end,
       case when exists (select 1 from pg_class c join user_schemas s on s.oid = c.relnamespace,
                         lateral aclexplode(c.relacl) a
                         where a.grantee = (select oid from pg_roles where rolname = session_user))
              or exists (select 1 from pg_attribute att join pg_class c on c.oid = att.attrelid
                         join user_schemas s on s.oid = c.relnamespace,
                         lateral aclexplode(att.attacl) a
                         where a.grantee = (select oid from pg_roles where rolname = session_user))
              or exists (select 1 from pg_proc p join user_schemas s on s.oid = p.pronamespace,
                         lateral aclexplode(p.proacl) a
                         where a.grantee = (select oid from pg_roles where rolname = session_user))
              or exists (select 1 from user_schemas s join pg_namespace n on n.oid = s.oid,
                         lateral aclexplode(n.nspacl) a
                         where a.grantee = (select oid from pg_roles where rolname = session_user))
            then 'has direct privileges' end,
       case when exists (select 1 from pg_db_role_setting rs, unnest(rs.setconfig) cfg
                         where rs.setdatabase in (0, (select oid from pg_database
                                                      where datname = current_database()))
                           and (rs.setrole = 0 or rs.setrole in (select oid from reachable))
                           and cfg like 'app.%')
              or exists (select 1 from unnest($2::text[]) n
                         where coalesce(current_setting(n, true), '') <> '')
            then 'app.* has a session default' end,
       case when not pg_has_role(session_user, $1, 'USAGE') then 'not a member of ' || $1 end
     ], null) as problems`,
    [group, CONTEXT_SETTINGS],
  );
  const [r] = rows;
  if (r.problems.length > 0) {
    throw new UnsafeDatabaseRoleError(
      `database role ${r.role} is not safe for the application: ${r.problems.join(", ")}`,
    );
  }
}

export type TenantContext = {
  tenantId: string;
  // `*` = every current and future branch (Level 2 roles, IAM-9).
  allowedBranchIds: readonly string[] | "*";
  activeBranchId?: string;
  staffId?: string;
  roles: readonly string[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLE = /^[a-z][a-z_]*$/;

function assertUuid(name: string, value: string | undefined): void {
  if (value !== undefined && !UUID.test(value)) throw new TypeError(`${name} is not a UUID`);
}

const active = new AsyncLocalStorage<true>();

// Runs fn in one transaction on a client checked out from the pool for this call only,
// (fn must not schedule work that outlives it: timers started inside fn inherit the
// nesting guard and their own withTenantContext calls are refused),
// with the TEN-2 settings bound transaction-locally (set_config(..., true)). Nesting is
// refused: a nested call would run in a second transaction with its own context. A
// client whose rollback failed is destroyed instead of returned to the pool.
export async function withTenantContext<T>(
  pool: pg.Pool,
  ctx: TenantContext,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  if (active.getStore()) throw new Error("withTenantContext cannot be nested");
  assertUuid("tenantId", ctx.tenantId);
  assertUuid("activeBranchId", ctx.activeBranchId);
  assertUuid("staffId", ctx.staffId);
  if (ctx.allowedBranchIds !== "*") {
    for (const id of ctx.allowedBranchIds) assertUuid("allowedBranchIds", id);
  }
  for (const role of ctx.roles) {
    if (!ROLE.test(role)) throw new TypeError("roles must match /^[a-z][a-z_]*$/");
  }

  const client = await pool.connect();
  let broken: Error | undefined;
  // A checked-out client has no pool idle listener: without this, a backend that dies
  // while held emits an unhandled 'error' and crashes the process.
  const onError = (error: Error) => {
    broken ??= error;
  };
  client.on("error", onError);
  try {
    try {
      await client.query("begin");
      await client.query(
        `select set_config('app.tenant_id', $1, true),
                set_config('app.allowed_branch_ids', $2, true),
                set_config('app.active_branch_id', $3, true),
                set_config('app.staff_id', $4, true),
                set_config('app.roles', $5, true)`,
        [
          ctx.tenantId,
          ctx.allowedBranchIds === "*" ? "*" : ctx.allowedBranchIds.join(","),
          ctx.activeBranchId ?? "",
          ctx.staffId ?? "",
          ctx.roles.join(","),
        ],
      );
      const result = await active.run(true, () => fn(client));
      await client.query("commit");
      // A session-level SET inside fn would outlive the transaction; clear it so the
      // pooled connection fails closed again. If the backend dies between commit and
      // this reset, the caller sees an error although the data is committed; the
      // client is destroyed either way (error listener / failed rollback).
      await client.query(
        `select set_config(n, '', false) from unnest($1::text[]) n
         where coalesce(current_setting(n, true), '') <> ''`,
        [CONTEXT_SETTINGS],
      );
      return result;
    } catch (error) {
      await client.query("rollback").catch((rollbackError: Error) => {
        broken = rollbackError;
      });
      throw error;
    }
  } finally {
    client.removeListener("error", onError);
    client.release(broken);
  }
}
