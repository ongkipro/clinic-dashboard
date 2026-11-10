// T-056 drift check: the clinical-request migration adds its table and functions and re-creates only
// plans_guard (0070), so that an item may open with no removing request and its one change, the removal, may also
// name the request that removed it. A database is migrated to exactly 0075, every public function and every
// policy captured, then to exactly 0076 and compared: every other function stays byte-identical (definition,
// volatility, SECURITY DEFINER, search_path, grants); plans_guard changes by exactly the two declared lines and
// keeps its attributes; the added functions are exactly the declared ones, granted to clinic_app only where the app
// calls them; no existing policy changed.
import { rmSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/db/migrate";
import { migrationsUpTo } from "./migrations-up-to";
import { createHarness, type Harness } from "../rls/harness";

const BEFORE_TAG = "0075_documents";
const AFTER_TAG = "0076_clinical_requests";
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

describe("T-056: the clinical-request migration re-creates only plans_guard", () => {
  it("no existing function changed or dropped except plans_guard, whose body changes by exactly two lines", () => {
    const changed: string[] = [];
    for (const [k, a] of after) {
      const b = before.get(k);
      if (!b) continue;
      if (b.def !== a.def) changed.push(k);
      expect({ k, volatile: a.volatile, secdef: a.secdef, config: a.config, acl: a.acl }).toEqual({ k, volatile: b.volatile, secdef: b.secdef, config: b.config, acl: b.acl });
    }
    expect(changed).toEqual(["plans_guard()"]);
    expect([...before.keys()].filter((k) => !after.has(k))).toEqual([]);
    const old = before.get("plans_guard()")!.def;
    const insertOld = "    IF n ->> 'removed_at' IS NOT NULL THEN\n";
    const insertNew = "    IF n ->> 'removed_at' IS NOT NULL OR n ->> 'removed_by_request_id' IS NOT NULL THEN\n";
    const updOld = "  IF o ->> 'removed_at' IS NOT NULL OR n ->> 'removed_at' IS NULL OR n - 'removed_at' IS DISTINCT FROM o - 'removed_at' THEN\n";
    const updNew = "  IF o ->> 'removed_at' IS NOT NULL OR n ->> 'removed_at' IS NULL\n     OR n - 'removed_at' - 'removed_by_request_id' IS DISTINCT FROM o - 'removed_at' - 'removed_by_request_id' THEN\n";
    expect(old.split(insertOld)).toHaveLength(2);
    expect(old.split(updOld)).toHaveLength(2);
    expect(after.get("plans_guard()")!.def).toBe(old.replace(insertOld, insertNew).replace(updOld, updNew));
  });

  it("the added functions are the request ones; only the writers and readers are granted to clinic_app", () => {
    const added = [...after.keys()].filter((k) => !before.has(k)).sort();
    const app = [
      "request_readable(uuid,uuid)", "clinical_request_create(uuid,jsonb)", "clinical_request_decide(uuid,boolean,text)", "clinical_request_cancel(uuid)",
      "clinical_request_list(text)", "clinical_request_get(uuid)", "clinical_request_options(uuid)",
    ];
    const internal = [
      "request_price_impact(clinical_requests)", "clinical_requests_guard()", "request_actor(text[])", "request_reader()",
      "request_json(clinical_requests,boolean,uuid,text)",
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
