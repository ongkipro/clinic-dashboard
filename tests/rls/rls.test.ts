// T-003 Done-when: startup refuses a BYPASSRLS role; a table missing from scope_map or
// classified twice fails; a cross-tenant read of a fixture row returns not-found.
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  APP_GROUP_ROLE,
  AUTH_GROUP_ROLE,
  assertAppRole,
  type TenantContext,
  UnsafeDatabaseRoleError,
  withTenantContext,
} from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { scopeMapViolations } from "../../src/db/scope-map";
import { createHarness, type Harness } from "./harness";

let h: Harness;
let app: pg.Pool;
let tenantA: string;
let tenantB: string;
let branchA: string;
let branchB: string;

async function newTenant(name: string): Promise<{ tenant: string; branch: string }> {
  const t = (await h.admin.query(`insert into tenants_registry default values returning id`))
    .rows[0].id as string;
  await h.admin.query(
    `insert into tenants (id, legal_name, sak_framework) values ($1, $2, 'emkm')`,
    [t, name],
  );
  const b = (
    await h.admin.query(
      `insert into branches (tenant_id, code, name, timezone)
       values ($1, 'CAB01', 'Cabang Sintetis', 'Asia/Jakarta') returning id`,
      [t],
    )
  ).rows[0].id as string;
  return { tenant: t, branch: b };
}

const ctx = (tenantId: string): TenantContext => ({
  tenantId,
  allowedBranchIds: "*",
  roles: ["owner"],
});

beforeAll(async () => {
  h = await createHarness();
  ({ tenant: tenantA, branch: branchA } = await newTenant("PT Sintetis A"));
  ({ tenant: tenantB, branch: branchB } = await newTenant("PT Sintetis B"));
  app = await openAppPool({
    connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])),
    max: 4,
  });
});

afterAll(async () => {
  await app?.end();
  await h?.close();
});

describe("startup role check (TEN-2)", () => {
  async function check(attrs: string, memberOf: string[]): Promise<unknown> {
    const c = await h.connectAs(await h.createLoginRole(attrs, memberOf));
    return assertAppRole(c).then(
      () => "accepted",
      (e: unknown) => e,
    );
  }

  it("application startup refuses a BYPASSRLS role and opens for a safe one", async () => {
    const unsafe = await h.createLoginRole("BYPASSRLS", [APP_GROUP_ROLE]);
    await expect(openAppPool({ connectionString: h.urlAs(unsafe) })).rejects.toBeInstanceOf(
      UnsafeDatabaseRoleError,
    );
    const safe = await h.createLoginRole("", [APP_GROUP_ROLE]);
    const pool = await openAppPool({ connectionString: h.urlAs(safe) });
    await pool.end();
  });

  it("the auth pool applies the same rules to clinic_auth, and the two groups are not interchangeable", async () => {
    const authLogin = await h.createLoginRole("", [AUTH_GROUP_ROLE]);
    await (await openAppPool({ connectionString: h.urlAs(authLogin) }, AUTH_GROUP_ROLE)).end();
    await expect(openAppPool({ connectionString: h.urlAs(authLogin) })).rejects.toThrow(
      `not a member of ${APP_GROUP_ROLE}`,
    );
    const both = await h.createLoginRole("", [AUTH_GROUP_ROLE, APP_GROUP_ROLE]);
    await expect(openAppPool({ connectionString: h.urlAs(both) }, AUTH_GROUP_ROLE)).rejects.toThrow(
      "member of unexpected role clinic_app",
    );
    const unsafe = await h.createLoginRole("BYPASSRLS", [AUTH_GROUP_ROLE]);
    await expect(openAppPool({ connectionString: h.urlAs(unsafe) }, AUTH_GROUP_ROLE)).rejects.toThrow(
      "bypassrls",
    );
  });

  it("accepts a plain member of clinic_app", async () => {
    expect(await check("", [APP_GROUP_ROLE])).toBe("accepted");
  });

  it("refuses a BYPASSRLS role", async () => {
    expect(String(await check("BYPASSRLS", [APP_GROUP_ROLE]))).toContain("bypassrls");
  });

  it("refuses a role that inherits BYPASSRLS through membership", async () => {
    const group = await h.createGroupRole("BYPASSRLS");
    expect(String(await check("", [APP_GROUP_ROLE, group]))).toContain("bypassrls");
  });

  it("refuses a superuser", async () => {
    expect(String(await assertAppRole(h.admin).catch((e) => e))).toContain("superuser");
  });

  it("checks the login, not the current role: a superuser that SET ROLE clinic_app is refused", async () => {
    await h.admin.query(`set role ${APP_GROUP_ROLE}`);
    try {
      expect(String(await assertAppRole(h.admin).catch((e) => e))).toContain("superuser");
    } finally {
      await h.admin.query(`reset role`);
    }
  });

  it("refuses membership in any role other than clinic_app (allow-list)", async () => {
    expect(String(await check("", [APP_GROUP_ROLE, "pg_read_all_data"]))).toContain(
      "member of unexpected role pg_read_all_data",
    );
  });

  it("refuses a REPLICATION login", async () => {
    expect(String(await check("REPLICATION", [APP_GROUP_ROLE]))).toContain("replication");
  });

  it("refuses direct table or column grants to the login", async () => {
    const direct = await h.createLoginRole("", [APP_GROUP_ROLE]);
    await h.admin.query(`grant select on tenants_registry to ${direct}`);
    const c = await h.connectAs(direct);
    expect(String(await assertAppRole(c).catch((e) => e))).toContain("has direct privileges");
    await h.admin.query(`revoke select on tenants_registry from ${direct}`);
    await h.admin.query(`grant select (lifecycle_state) on tenants_registry to ${direct}`);
    expect(String(await assertAppRole(c).catch((e) => e))).toContain("has direct privileges");
    await h.admin.query(`revoke select (lifecycle_state) on tenants_registry from ${direct}`);
    await h.admin.query(
      `create function definer_direct() returns int language sql security definer as 'select 1'`,
    );
    await h.admin.query(`grant execute on function definer_direct() to ${direct}`);
    expect(String(await assertAppRole(c).catch((e) => e))).toContain("has direct privileges");
    await h.admin.query(`drop function definer_direct()`);
    await h.admin.query(`grant usage on schema public to ${direct}`);
    expect(String(await assertAppRole(c).catch((e) => e))).toContain("has direct privileges");
    await h.admin.query(`revoke usage on schema public from ${direct}`);
    expect(await assertAppRole(c)).toBeUndefined();
  });

  it("refuses a session default for app.* settings (policies must fail closed)", async () => {
    const preset = await h.createLoginRole("", [APP_GROUP_ROLE]);
    await h.admin.query(`alter role ${preset} set app.tenant_id = '${tenantA}'`);
    const c = await h.connectAs(preset);
    expect(String(await assertAppRole(c).catch((e) => e))).toContain("app.* has a session default");
    const viaOptions = await h.createLoginRole("", [APP_GROUP_ROLE]);
    for (const option of [`-c app.tenant_id=${tenantA}`, "-c app.roles=owner", "-c app.allowed_branch_ids=*"]) {
      await expect(
        openAppPool({ connectionString: h.urlAs(viaOptions), options: option }),
      ).rejects.toThrow("app.* has a session default");
    }
  });

  it("refuses CREATEROLE and CREATEDB logins", async () => {
    expect(String(await check("CREATEROLE", [APP_GROUP_ROLE]))).toContain("createrole/createdb");
    expect(String(await check("CREATEDB", [APP_GROUP_ROLE]))).toContain("createrole/createdb");
  });

  it("refuses a member of a role that owns tables (owners skip RLS)", async () => {
    const owner = await h.createGroupRole("");
    await h.admin.query(`create table owned_probe (id int)`);
    await h.admin.query(`alter table owned_probe owner to ${owner}`);
    try {
      expect(String(await check("", [APP_GROUP_ROLE, owner]))).toContain("owns relations");
    } finally {
      await h.admin.query(`drop table owned_probe`);
    }
  });

  it("refuses the database owner and a schema owner", async () => {
    const dbOwner = await h.createLoginRole("", [APP_GROUP_ROLE]);
    await h.admin.query(`alter database ${h.dbName} owner to ${dbOwner}`);
    try {
      const c = await h.connectAs(dbOwner);
      expect(String(await assertAppRole(c).catch((e) => e))).toContain("owns the database");
    } finally {
      await h.admin.query(`alter database ${h.dbName} owner to current_user`);
    }
    const schemaOwner = await h.createGroupRole("");
    await h.admin.query(`create schema probe authorization ${schemaOwner}`);
    try {
      expect(String(await check("", [APP_GROUP_ROLE, schemaOwner]))).toContain("owns a schema");
    } finally {
      await h.admin.query(`drop schema probe`);
    }
  });

  it("refuses a login that can create objects", async () => {
    const creator = await h.createGroupRole("");
    await h.admin.query(`grant create on schema public to ${creator}`);
    try {
      expect(String(await check("", [APP_GROUP_ROLE, creator]))).toContain("can create objects");
    } finally {
      await h.admin.query(`revoke create on schema public from ${creator}`);
    }
  });

  it("refuses a login granted TEMPORARY on the database (temp tables shadow names)", async () => {
    const temp = await h.createLoginRole("", [APP_GROUP_ROLE]);
    await h.admin.query(`grant temporary on database ${h.dbName} to ${temp}`);
    const c = await h.connectAs(temp);
    expect(String(await assertAppRole(c).catch((e) => e))).toContain("can create objects");
  });

  it("refuses TEMPORARY granted to PUBLIC (the migration revokes it; drift must not pass)", async () => {
    const plain = await h.createLoginRole("", [APP_GROUP_ROLE]);
    const c = await h.connectAs(plain);
    expect(await assertAppRole(c)).toBeUndefined();
    await h.admin.query(`grant temporary on database ${h.dbName} to public`);
    try {
      expect(String(await assertAppRole(c).catch((e) => e))).toContain("can create objects");
    } finally {
      await h.admin.query(`revoke temporary on database ${h.dbName} from public`);
    }
  });

  it("refuses a NOINHERIT member (it would not receive clinic_app grants)", async () => {
    expect(String(await check("NOINHERIT", [APP_GROUP_ROLE]))).toContain(
      `not a member of ${APP_GROUP_ROLE}`,
    );
  });

  it("refuses a role that is not a member of clinic_app", async () => {
    expect(String(await check("", []))).toContain(`not a member of ${APP_GROUP_ROLE}`);
  });

  it("a login without an explicit CONNECT grant cannot reach the database", async () => {
    const outsider = await h.createLoginRole("", [APP_GROUP_ROLE]);
    await h.admin.query(`revoke connect on database ${h.dbName} from ${outsider}`);
    await expect(h.connectAs(outsider)).rejects.toMatchObject({ code: "42501" });
  });
});

describe("scope map (TEN-3, TEN-19)", () => {
  // Every relation kind that can expose rows: table, partitioned table, view,
  // materialized view, foreign table.
  async function relations(c: pg.ClientBase): Promise<string[]> {
    const { rows } = await c.query<{ t: string }>(
      `select n.nspname || '.' || c.relname as t from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where c.relkind in ('r','p','v','m','f')
         and n.nspname not in ('pg_catalog','information_schema','drizzle')
         and n.nspname not like 'pg_toast%' and n.nspname not like 'pg_temp%'`,
    );
    return rows.map((r) => r.t);
  }
  async function entries(c: pg.ClientBase) {
    const { rows } = await c.query<{ tableName: string; policyKind: string }>(
      `select table_name as "tableName", policy_kind as "policyKind" from scope_map`,
    );
    return rows;
  }
  async function inRolledBack<T>(ddl: string, fn: () => Promise<T>): Promise<T> {
    await h.admin.query("begin");
    try {
      await h.admin.query(ddl);
      return await fn();
    } finally {
      await h.admin.query("rollback");
    }
  }

  it("classifies every relation exactly once", async () => {
    expect(scopeMapViolations(await relations(h.admin), await entries(h.admin))).toEqual([]);
  });

  it("fails on a table missing from scope_map", async () => {
    const v = await inRolledBack(`create table patients (id uuid primary key)`, async () =>
      scopeMapViolations(await relations(h.admin), await entries(h.admin)),
    );
    expect(v).toEqual(["public.patients: missing from scope_map"]);
  });

  it("fails on a view or materialized view missing from scope_map", async () => {
    const v = await inRolledBack(
      `create view branch_names as select name from branches;
       create materialized view branch_count as select count(*) from branches`,
      async () => scopeMapViolations(await relations(h.admin), await entries(h.admin)),
    );
    expect(v).toEqual([
      "public.branch_count: missing from scope_map",
      "public.branch_names: missing from scope_map",
    ]);
  });

  it("fails on a table classified twice", () => {
    expect(
      scopeMapViolations(
        ["public.branches"],
        [
          { tableName: "public.branches", policyKind: "tenant-shared" },
          { tableName: "public.branches", policyKind: "branch-scoped" },
        ],
      ),
    ).toEqual(["public.branches: classified 2 times"]);
  });

  it("fails on a stale row and an unknown policy kind", () => {
    expect(scopeMapViolations([], [{ tableName: "public.ghosts", policyKind: "public" }])).toEqual(
      [
        "public.ghosts: scope_map row for a table that does not exist",
        "public.ghosts: unknown policy kind public",
      ],
    );
  });

  it("has RLS enabled on every table", async () => {
    const { rows } = await h.admin.query<{ t: string }>(
      `select n.nspname || '.' || c.relname as t from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where c.relkind in ('r','p') and not c.relrowsecurity
         and n.nspname not in ('pg_catalog','information_schema','drizzle')
         and n.nspname not like 'pg_toast%'`,
    );
    expect(rows).toEqual([]);
  });

  // Views run with the owner's rights unless security_invoker is set, and materialized
  // and foreign tables have no RLS; none may be readable by the app without it.
  it("the app cannot read a view without security_invoker, a matview or a foreign table", async () => {
    const { rows } = await h.admin.query<{ t: string }>(
      `select n.nspname || '.' || c.relname as t from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where c.relkind in ('v','m','f')
         and n.nspname not in ('pg_catalog','information_schema')
         and (has_table_privilege($1, c.oid, 'SELECT')
              or has_any_column_privilege($1, c.oid, 'SELECT'))
         and not (c.relkind = 'v' and coalesce(c.reloptions, '{}') @> '{security_invoker=true}')`,
      [APP_GROUP_ROLE],
    );
    expect(rows).toEqual([]);
  });

  it("the app has no privilege on platform tables", async () => {
    const { rows } = await h.admin.query<{ t: string }>(
      `select s.table_name as t from scope_map s
       join pg_class c on c.oid = to_regclass(s.table_name)
       where s.policy_kind = 'platform'
         and (has_table_privilege($1, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
              or has_any_column_privilege($1, c.oid, 'SELECT,INSERT,UPDATE,REFERENCES'))`,
      [APP_GROUP_ROLE],
    );
    expect(rows).toEqual([]);
  });
});

describe("functions (TEN-16)", () => {
  // Security-definer functions run as their owner and skip RLS; the app may execute
  // only those on this allow-list; each entry has its own tests (tests/org).
  const ALLOWED_DEFINER_FUNCTIONS: string[] = [
    "account_memberships(uuid)",
    "approval_cancel(uuid)",
    "approval_decide(uuid,boolean,text)",
    "approval_owner_self(text,text,uuid,text,uuid,bigint)",
    "approval_request(text,text,uuid,text,uuid,bigint)",
    "audit_append(text,text,uuid,text,text,text,uuid)",
    "audit_verify(uuid)",
    "events_claim(text,text,integer,integer)",
    "notification_ack(uuid)",
    "notification_labels()",
    "notification_raise(text,text,uuid,uuid,text,uuid,uuid)",
    "role_assign(uuid,text)",
    "role_request_decide(uuid,boolean)",
    "setting_default(text)",
    "setting_draft_cancel(uuid)",
    "setting_draft_decide(uuid,boolean,text)",
    "setting_role_sees(text)",
    "setting_set(text,uuid,jsonb,timestamp with time zone,text,boolean)",
    "staff_branch_set(uuid,text,uuid,boolean)",
    "staff_duty_set(uuid,text,boolean)",
    "staff_end_membership(uuid)",
    "staff_invite(text,text,text[],uuid[],text,integer)",
    "staff_invite_accept(text,uuid)",
    "staff_invite_cancel(uuid)",
    "staff_invite_lookup(text)",
    "staff_role_remove(uuid,text)",
    "staff_session_revoke(uuid,uuid)",
    "staff_session_revoked(uuid,uuid)",
    "staff_sessions(uuid)",
    "vendor_go_live_allowed()",
    "vendor_identity()",
  ];

  it("the app executes no SECURITY DEFINER function outside the allow-list", async () => {
    const { rows } = await h.admin.query<{ f: string }>(
      `select p.oid::regprocedure::text as f from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where p.prosecdef and n.nspname not in ('pg_catalog','information_schema')
         and has_function_privilege($1, p.oid, 'EXECUTE')`,
      [APP_GROUP_ROLE],
    );
    expect(rows.map((r) => r.f).filter((f) => !ALLOWED_DEFINER_FUNCTIONS.includes(f))).toEqual([]);
  });

  it("a new function is not executable by PUBLIC by default", async () => {
    await h.admin.query("begin");
    try {
      await h.admin.query(
        `create function definer_probe() returns int language sql security definer as 'select 1'`,
      );
      const { rows } = await h.admin.query<{ ok: boolean }>(
        `select has_function_privilege($1, 'definer_probe()', 'EXECUTE') as ok`,
        [APP_GROUP_ROLE],
      );
      expect(rows[0].ok).toBe(false);
    } finally {
      await h.admin.query("rollback");
    }
  });
});

describe("tenant isolation under clinic_app (PR-1, TEN-1, TEN-2)", () => {
  it("reads its own tenant and branch", async () => {
    const r = await withTenantContext(app, ctx(tenantA), async (c) => ({
      tenants: (await c.query(`select id from tenants`)).rows.map((x) => x.id),
      branches: (await c.query(`select id from branches`)).rows.map((x) => x.id),
    }));
    expect(r).toEqual({ tenants: [tenantA], branches: [branchA] });
  });

  it("gets not-found for another tenant's branch by id", async () => {
    const rows = await withTenantContext(app, ctx(tenantA), async (c) =>
      (await c.query(`select * from branches where id = $1`, [branchB])).rows,
    );
    expect(rows).toEqual([]);
  });

  it("gets not-found for another tenant's row by id", async () => {
    const rows = await withTenantContext(app, ctx(tenantA), async (c) =>
      (await c.query(`select * from tenants where id = $1`, [tenantB])).rows,
    );
    expect(rows).toEqual([]);
  });

  it("sees nothing without tenant context (fails closed)", async () => {
    expect((await app.query(`select * from branches`)).rows).toEqual([]);
    expect((await app.query(`select * from tenants`)).rows).toEqual([]);
  });

  it("does not carry context past the transaction on a pooled connection", async () => {
    const one = await openAppPool({ connectionString: app.options.connectionString, max: 1 });
    try {
      await withTenantContext(one, ctx(tenantA), async () => undefined);
      const { rows } = await one.query(`select current_setting('app.tenant_id', true) as t`);
      expect(rows[0].t ?? "").toBe("");
      expect((await one.query(`select * from branches`)).rows).toEqual([]);
    } finally {
      await one.end();
    }
  });

  it("clears a session-level SET made inside the callback", async () => {
    const one = await openAppPool({ connectionString: app.options.connectionString, max: 1 });
    try {
      await withTenantContext(one, ctx(tenantA), async (c) => {
        await c.query(`select set_config('app.tenant_id', $1, false)`, [tenantA]);
      });
      expect((await one.query(`select * from branches`)).rows).toEqual([]);
    } finally {
      await one.end();
    }
  });

  it("rolls back and clears context when the callback throws (same connection)", async () => {
    const one = await openAppPool({ connectionString: app.options.connectionString, max: 1 });
    try {
      await expect(
        withTenantContext(one, ctx(tenantA), async (c) => {
          await c.query(`select 1`);
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      expect((await one.query(`select * from branches`)).rows).toEqual([]);
      expect((await one.query(`select txid_current_if_assigned() as t`)).rows[0].t).toBeNull();
    } finally {
      await one.end();
    }
  });

  it("destroys a connection that dies mid-transaction instead of reusing it", async () => {
    const one = await openAppPool({ connectionString: app.options.connectionString, max: 1 });
    try {
      const pid = await withTenantContext(one, ctx(tenantA), async (c) =>
        (await c.query(`select pg_backend_pid() as p`)).rows[0].p as number,
      );
      await expect(
        withTenantContext(one, ctx(tenantA), async (c) => {
          const died = new Promise((resolve) => c.once("error", resolve));
          await h.admin.query(`select pg_terminate_backend($1)`, [pid]);
          await died;
          throw new Error("connection lost");
        }),
      ).rejects.toThrow("connection lost");
      const next = (await one.query(`select pg_backend_pid() as p`)).rows[0].p as number;
      expect(next).not.toBe(pid);
      expect((await one.query(`select * from branches`)).rows).toEqual([]);
    } finally {
      await one.end().catch(() => {});
    }
  });

  it("refuses nesting", async () => {
    await expect(
      withTenantContext(app, ctx(tenantA), () =>
        withTenantContext(app, ctx(tenantB), async () => "inner"),
      ),
    ).rejects.toThrow("cannot be nested");
  });

  it("keeps concurrent calls isolated (each holds its own connection)", async () => {
    const read = (t: string) =>
      withTenantContext(app, ctx(t), async (c) => {
        await c.query(`select pg_sleep(0.05)`);
        return (await c.query(`select tenant_id from branches`)).rows.map((x) => x.tenant_id);
      });
    const results = await Promise.all([read(tenantA), read(tenantB), read(tenantA), read(tenantB)]);
    expect(results).toEqual([[tenantA], [tenantB], [tenantA], [tenantB]]);
  });

  it("cannot write branches or touch platform tables", async () => {
    await withTenantContext(app, ctx(tenantA), async (c) => {
      await c.query("savepoint s");
      await expect(
        c.query(
          `insert into branches (tenant_id, code, name, timezone)
           values ($1, 'X', 'X', 'Asia/Jakarta')`,
          [tenantA],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await c.query("rollback to savepoint s");
      await expect(c.query(`select * from tenants_registry`)).rejects.toMatchObject({
        code: "42501",
      });
      await c.query("rollback to savepoint s");
      await expect(c.query(`select * from scope_map`)).rejects.toMatchObject({ code: "42501" });
      await c.query("rollback to savepoint s");
      await expect(c.query(`create table mine (id int)`)).rejects.toMatchObject({
        code: "42501",
      });
      await c.query("rollback to savepoint s");
    });
  });

  it("rejects malformed context values before touching the database", async () => {
    await expect(
      withTenantContext(app, { ...ctx(tenantA), tenantId: "' or true --" }, async () => undefined),
    ).rejects.toThrow("tenantId is not a UUID");
    await expect(
      withTenantContext(app, { ...ctx(tenantA), roles: ["owner,finance"] }, async () => undefined),
    ).rejects.toThrow("roles must match");
  });

  it("a forged non-UUID setting errors instead of widening access", async () => {
    const c = await app.connect();
    try {
      await c.query("begin");
      await c.query(`select set_config('app.tenant_id', 'x'' or true', true)`);
      await expect(c.query(`select * from branches`)).rejects.toMatchObject({ code: "22P02" });
      await c.query("rollback");
    } finally {
      c.release();
    }
  });
});
