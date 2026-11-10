// T-052 drift check: the examination migration adds its tables and functions and re-creates only
// patient_cautions (0069), whose result now comes from exam_cautions (a verified allergy is reported as
// clinician_verified). A database is migrated to exactly 0069, every public function and every policy
// captured, then to exactly 0070 and compared: every other function stays byte-identical (definition,
// volatility, SECURITY DEFINER, search_path, grants); patient_cautions changes by exactly one block and keeps
// its attributes; the added functions are exactly the declared ones, granted to clinic_app only where the
// app calls them; no existing policy changed.
import { rmSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/db/migrate";
import { migrationsUpTo } from "./migrations-up-to";
import { createHarness, type Harness } from "../rls/harness";

const BEFORE_TAG = "0069_intakes";
const AFTER_TAG = "0070_examinations";
type Fn = { def: string; volatile: string; secdef: boolean; config: string | null; acl: string | null };

let h: Harness;
let before: Map<string, Fn>;
let after: Map<string, Fn>;
let policiesBefore: Map<string, string>;
let policiesAfter: Map<string, string>;
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

beforeAll(async () => {
  const toBefore = migrationsUpTo(BEFORE_TAG);
  const toAfter = migrationsUpTo(AFTER_TAG);
  dirs = [toBefore, toAfter];
  let url = "";
  h = await createHarness({ migrate: async (u) => { url = u; await runMigrations(u, { folder: toBefore }); } });
  before = await capture(h.admin);
  policiesBefore = await policies(h.admin);
  await runMigrations(url, { folder: toAfter });
  after = await capture(h.admin);
  policiesAfter = await policies(h.admin);
}, 300_000);

afterAll(async () => {
  await h?.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("T-052: the examination migration re-creates only patient_cautions", () => {
  it("no existing function changed or dropped except patient_cautions, whose body changes by exactly one block", () => {
    const changed: string[] = [];
    for (const [k, a] of after) {
      const b = before.get(k);
      if (!b) continue;
      if (b.def !== a.def) changed.push(k);
      expect({ k, volatile: a.volatile, secdef: a.secdef, config: a.config, acl: a.acl }).toEqual({ k, volatile: b.volatile, secdef: b.secdef, config: b.config, acl: b.acl });
    }
    expect(changed).toEqual(["patient_cautions(uuid)"]);
    expect([...before.keys()].filter((k) => !after.has(k))).toEqual([]);
    const k = "patient_cautions(uuid)";
    const old = before.get(k)!.def;
    const tail = /  RETURN coalesce\(\(\n    SELECT jsonb_agg\(jsonb_build_object\('fact_id', h\.id, 'kind', h\.kind, 'value', h\.value, 'provenance', h\.provenance,\n             'sent_at', \(SELECT ii\.sent_at FROM public\.intakes ii WHERE ii\.tenant_id = h\.tenant_id AND ii\.id = h\.intake_id\)\)\)\n      FROM public\.intake_history\(a\.tenant_id, v_canon, NULL\) h\n     WHERE h\.kind = 'allergy' AND h\.provenance = 'bc_captured_unverified'\), '\[\]'::jsonb\);\n/;
    expect(old).toMatch(tail);
    expect(after.get(k)!.def).toBe(old.replace(tail, "  RETURN public.exam_cautions(a.tenant_id, v_canon);\n"));
  });

  it("the added functions are the examination ones; only the writers and readers are granted to clinic_app", () => {
    const added = [...after.keys()].filter((k) => !before.has(k)).sort();
    const app = [
      "exam_open(uuid)", "exam_save(uuid,jsonb)", "intake_verify(uuid,uuid,text,text)", "mark_set(uuid,jsonb)", "mark_remove(uuid,uuid)",
      "plan_create(uuid,text,text)", "plan_item_add(uuid,uuid,jsonb)", "plan_item_remove(uuid,uuid)", "plan_close(uuid,uuid,text)",
      "pemeriksaan_visits(uuid)", "exam_sheet(uuid)", "plan_options(uuid)", "exam_readable(uuid,uuid)",
    ];
    const internal = [
      "examinations_guard()", "exam_parts_guard()", "plans_guard()", "exam_changed(uuid,text,text,uuid,text,jsonb)", "exam_actor()", "exam_draft(uuid)",
      "exam_version(uuid,uuid,text[])", "exam_plan(examinations,uuid)", "exam_plans_json(uuid,uuid,uuid,boolean)", "exam_cautions(uuid,uuid)",
    ];
    expect(added).toEqual([...app, ...internal].sort());
    for (const k of added) {
      const acl = after.get(k)!.acl ?? "";
      expect(after.get(k)!.acl, k).not.toBeNull();
      if (app.includes(k)) expect(acl, k).toMatch(/clinic_app=X\//);
      else expect(acl, k).not.toMatch(/clinic_(app|vendor|executor|operator)=X\//);
      expect(acl, k).not.toMatch(/[{,]=X\//);
    }
  });

  it("no existing policy changed or dropped", () => {
    for (const [k, v] of policiesBefore) expect(policiesAfter.get(k), k).toBe(v);
  });
});
