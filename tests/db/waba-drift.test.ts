// T-089 drift check: the WABA migration (0104) adds waba_accounts, token_vault, wa_numbers and waba_routes with their guards, RLS predicates,
// writers, readers and the webhook helpers, and re-creates NO existing function (CHANGED = []; `tenant_data_key_ensure` stays as 0057 left it).
// Every existing function stays byte-identical with its attributes; no existing policy or check changes; the new triggers are ENABLE ALWAYS; the
// vault has no grant and is never supportable; the number's sealed PIN is not granted. A database is migrated to exactly 0103, then to 0104.
import { rmSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/db/migrate";
import { migrationsUpTo } from "../db/migrations-up-to";
import { createHarness, type Harness } from "../rls/harness";

type Fn = { def: string; volatile: string; secdef: boolean; config: string | null; acl: string | null };
let h: Harness;
let before: Map<string, Fn>;
let after: Map<string, Fn>;
let policiesBefore: Map<string, string>;
let policiesAfter: Map<string, string>;
let checksBefore: Map<string, string>;
let checksAfter: Map<string, string>;
let dirs: string[] = [];

async function capture(db: pg.ClientBase): Promise<Map<string, Fn>> {
  const r = await db.query<{ k: string; def: string; volatile: string; secdef: boolean; config: string[] | null; acl: string | null }>(
    `select p.oid::regprocedure::text as k, pg_get_functiondef(p.oid) as def, p.provolatile as volatile, p.prosecdef as secdef,
            p.proconfig as config, p.proacl::text as acl
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind = 'f'
        and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')`,
  );
  return new Map(r.rows.map((x) => [x.k, { def: x.def, volatile: x.volatile, secdef: x.secdef, config: x.config?.join(";") ?? null, acl: x.acl }]));
}
async function policies(db: pg.ClientBase): Promise<Map<string, string>> {
  const r = await db.query<{ k: string; v: string }>(
    `select c.relname || '.' || p.polname as k, p.polcmd::text || ' ' || p.polroles::text || ' ' || coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') as v
       from pg_policy p join pg_class c on c.oid = p.polrelid`,
  );
  return new Map(r.rows.map((x) => [x.k, x.v]));
}
async function checks(db: pg.ClientBase): Promise<Map<string, string>> {
  const r = await db.query<{ k: string; v: string }>(
    `select c.relname || '.' || k.conname as k, pg_get_constraintdef(k.oid) as v from pg_constraint k join pg_class c on c.oid = k.conrelid
      join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'`,
  );
  return new Map(r.rows.map((x) => [x.k, x.v]));
}

beforeAll(async () => {
  const toBefore = migrationsUpTo("0103_staff_targets");
  const toAfter = migrationsUpTo("0104_waba");
  dirs = [toBefore, toAfter];
  let url = "";
  h = await createHarness({ migrate: async (u) => { url = u; await runMigrations(u, { folder: toBefore }); } });
  before = await capture(h.admin);
  policiesBefore = await policies(h.admin);
  checksBefore = await checks(h.admin);
  await runMigrations(url, { folder: toAfter });
  after = await capture(h.admin);
  policiesAfter = await policies(h.admin);
  checksAfter = await checks(h.admin);
}, 300_000);
afterAll(async () => {
  await h?.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const APP = ["waba_accounts_readable(uuid)", "wa_numbers_readable(uuid,uuid)", "waba_data_key_ensure(text)", "waba_signup_start(text,jsonb)",
  "waba_complete_signup(uuid,jsonb)", "waba_add_number(text,uuid,jsonb)", "waba_register_number(uuid,jsonb)", "waba_sync_status(uuid,jsonb)",
  "waba_migrate_to_cloud_api(uuid,jsonb)", "waba_revoke(uuid,text)", "waba_status()", "waba_sealed_token(uuid)", "waba_sealed_pin(uuid)",
  "waba_webhook_account_update(text,text,jsonb)", "waba_route_resolve(text)"];
const INTERNAL = ["waba_audit_service(uuid,text,text,uuid,text,text)", "waba_accounts_guard()", "token_vault_guard()", "wa_numbers_guard()",
  "waba_routes_guard()", "waba_brand(uuid)", "waba_actor()", "waba_mock_allowed()", "wa_number_next_state(text,text,text)",
  "waba_derive_state(uuid,uuid)", "waba_revoke_do(uuid,uuid,text,uuid,text,timestamp with time zone)"];
const TABLES = ["waba_accounts", "token_vault", "wa_numbers", "waba_routes"];

describe("T-089: the WABA migration re-creates no existing function", () => {
  it("every existing function is byte-identical with its attributes; nothing dropped", () => {
    const changed: string[] = [];
    for (const [k, a] of after) {
      const b = before.get(k);
      if (!b) continue;
      if (b.def !== a.def) changed.push(k);
      expect({ k, volatile: a.volatile, secdef: a.secdef, config: a.config, acl: a.acl }).toEqual({ k, volatile: b.volatile, secdef: b.secdef, config: b.config, acl: b.acl });
    }
    expect(changed).toEqual([]);
    expect([...before.keys()].filter((x) => !after.has(x))).toEqual([]);
  });
  it("the added functions are exactly the WABA ones; only the app-facing ones and the RLS predicates are granted; definers pin the path", () => {
    const added = [...after.keys()].filter((k) => !before.has(k)).sort();
    expect(added).toEqual([...APP, ...INTERNAL].sort());
    for (const k of added) {
      const acl = after.get(k)!.acl ?? "";
      expect(after.get(k)!.acl, k).not.toBeNull();
      if (APP.includes(k)) expect(acl, k).toMatch(/clinic_app=X\//);
      else expect(acl, k).not.toMatch(/clinic_(app|vendor|executor|operator)=X\//);
      expect(acl, k).not.toMatch(/[{,]=X\//);
      if (after.get(k)!.secdef) expect(after.get(k)!.config, k).toBe("search_path=pg_catalog, pg_temp");
    }
    // only the app-facing writers/readers are definers (the predicates, guards and helpers are not)
    expect(added.filter((k) => after.get(k)!.secdef).sort()).toEqual(APP.filter((k) => !k.includes("_readable(")).sort());
  });
  it("no existing policy or check changed", () => {
    for (const [k, v] of policiesBefore) expect(policiesAfter.get(k), k).toBe(v);
    expect([...checksBefore.keys()].filter((k) => checksAfter.get(k) !== checksBefore.get(k))).toEqual([]);
  });
  it("the tables are RLS-protected, not writable by the app, guarded and never truncated", async () => {
    for (const t of TABLES) {
      expect((await h.admin.query(`select relrowsecurity r from pg_class where relname = $1`, [t])).rows[0].r, t).toBe(true);
      for (const role of ["clinic_app", "clinic_operator", "clinic_vendor"]) {
        const p = (await h.admin.query(`select has_table_privilege($1, $2, 'INSERT') i, has_table_privilege($1, $2, 'UPDATE') u, has_table_privilege($1, $2, 'DELETE') d`,
          [role, `public.${t}`])).rows[0];
        expect([t, role, p.i, p.u, p.d]).toEqual([t, role, false, false, false]);
      }
      const trg = (await h.admin.query(`select tgname, tgenabled from pg_trigger where tgrelid = $1::regclass and not tgisinternal order by 1`, [`public.${t}`])).rows;
      expect(trg.map((x) => [x.tgname, x.tgenabled])).toEqual([[`${t}_guard`, "A"], [`${t}_no_truncate`, "A"]]);
    }
  });
  it("the vault and the routes have no grant; the sealed PIN is not granted; the scope map and support classes", async () => {
    for (const role of ["clinic_app", "clinic_operator", "clinic_vendor"]) {
      for (const t of ["token_vault", "waba_routes"]) {
        expect((await h.admin.query(`select has_table_privilege($1, $2, 'SELECT') s, has_any_column_privilege($1, $2, 'SELECT') c`, [role, `public.${t}`])).rows[0], `${role} ${t}`)
          .toEqual({ s: false, c: false });
      }
      for (const c of ["registration_pin_enc", "pin_dek_ref"]) {
        expect((await h.admin.query(`select has_column_privilege($1, 'public.wa_numbers', $2, 'SELECT') s`, [role, c])).rows[0].s, `${role} ${c}`).toBe(false);
      }
    }
    for (const role of ["clinic_app", "clinic_operator"]) {
      expect((await h.admin.query(`select has_column_privilege($1, 'public.wa_numbers', 'phone_number_id', 'SELECT') s`, [role])).rows[0].s).toBe(true);
      expect((await h.admin.query(`select has_table_privilege($1, 'public.waba_accounts', 'SELECT') s`, [role])).rows[0].s).toBe(true);
    }
    expect((await h.admin.query(`select table_name, policy_kind, owning_module from scope_map where table_name = any($1) order by 1`, [TABLES.map((t) => `public.${t}`)])).rows.sort((a, b) => (a.table_name < b.table_name ? -1 : 1))).toEqual([
      { table_name: "public.token_vault", policy_kind: "tenant-shared", owning_module: "messaging" },
      { table_name: "public.wa_numbers", policy_kind: "tenant-shared", owning_module: "messaging" },
      { table_name: "public.waba_accounts", policy_kind: "tenant-shared", owning_module: "messaging" },
      { table_name: "public.waba_routes", policy_kind: "platform", owning_module: "messaging" },
    ]);
    expect((await h.admin.query(`select table_name, support_class from support_object_kinds where table_name = any($1) order by 1`, [TABLES.map((t) => `public.${t}`)])).rows.sort((a, b) => (a.table_name < b.table_name ? -1 : 1))).toEqual([
      { table_name: "public.token_vault", support_class: "never" },
      { table_name: "public.wa_numbers", support_class: "config" },
      { table_name: "public.waba_accounts", support_class: "config" },
    ]);
    expect((await h.admin.query(`select recipient_roles, subject_kinds, raisable_by_staff from notification_types where key = 'waba_revoked'`)).rows)
      .toEqual([{ recipient_roles: ["owner"], subject_kinds: ["waba_account"], raisable_by_staff: false }]);
  });
});
