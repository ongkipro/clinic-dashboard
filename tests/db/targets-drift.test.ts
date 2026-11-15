// T-088 drift check: the targets migration (0103) adds staff_targets, its guard, RLS predicate, writer, readers and the attainment helpers,
// and re-creates NO existing function (CHANGED = []). Every existing function stays byte-identical with its attributes; no existing policy or
// check changes; the new triggers are ENABLE ALWAYS; the target is personal for vendor support. A database is migrated to exactly 0102, then
// to exactly 0103 (compared in-process; plan r2 build note).
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
  const toBefore = migrationsUpTo("0102_commission");
  const toAfter = migrationsUpTo("0103_staff_targets");
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

const APP = ["staff_target_set(text,uuid,text,jsonb)", "staff_targets_readable(uuid,uuid)", "target_list(text,uuid)", "target_mine(text)", "target_own_roles()"];
const INTERNAL = ["staff_targets_guard()", "target_closing_value(uuid,uuid,timestamp with time zone,timestamp with time zone,uuid)",
  "target_collected_share(uuid,uuid,uuid,timestamp with time zone)", "target_net(numeric,invoice_lines)", "target_period(text)",
  "target_plans_selected(uuid,uuid,timestamp with time zone,timestamp with time zone)", "target_row(uuid,uuid,text,timestamp with time zone,timestamp with time zone,uuid)",
  "target_scorecard(uuid,uuid,timestamp with time zone,timestamp with time zone)"];

describe("T-088: the targets migration re-creates no existing function", () => {
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
  it("the added functions are exactly the target ones; only the writer, readers and the RLS predicate are granted; definers pin the path", () => {
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
  });
  it("no existing policy or check changed", () => {
    for (const [k, v] of policiesBefore) expect(policiesAfter.get(k), k).toBe(v);
    expect([...checksBefore.keys()].filter((k) => checksAfter.get(k) !== checksBefore.get(k))).toEqual([]);
  });
  it("staff_targets is RLS-protected, not writable by the app, guarded and never truncated; scope map and support class", async () => {
    expect((await h.admin.query(`select relrowsecurity r from pg_class where relname = 'staff_targets'`)).rows[0].r).toBe(true);
    const p = (await h.admin.query(`select has_table_privilege('clinic_app', 'public.staff_targets', 'INSERT') i, has_table_privilege('clinic_app', 'public.staff_targets', 'UPDATE') u,
                                           has_table_privilege('clinic_app', 'public.staff_targets', 'DELETE') d`)).rows[0];
    expect([p.i, p.u, p.d]).toEqual([false, false, false]);
    const t = (await h.admin.query(`select tgname, tgenabled from pg_trigger where tgrelid = 'public.staff_targets'::regclass and not tgisinternal order by 1`)).rows;
    expect(t.map((x) => [x.tgname, x.tgenabled])).toEqual([["staff_targets_guard", "A"], ["staff_targets_no_truncate", "A"]]);
    expect((await h.admin.query(`select policy_kind, owning_module from scope_map where table_name = 'public.staff_targets'`)).rows).toEqual([{ policy_kind: "tenant-ledger", owning_module: "commission" }]);
    expect((await h.admin.query(`select support_class from support_object_kinds where table_name = 'public.staff_targets'`)).rows).toEqual([{ support_class: "personal" }]);
  });
});
