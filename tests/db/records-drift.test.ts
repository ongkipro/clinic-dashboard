// T-053 drift check: the records migration adds its tables and functions and re-creates only examinations_guard
// (signing: draft → signed changes only the state and the signature) and exam_sheet (a signed examination shows
// its latest version). A database is migrated to exactly 0070, every public function and policy captured, then
// to exactly 0071 and compared: every other function stays byte-identical (definition, volatility, SECURITY
// DEFINER, search_path, grants); the two re-created ones change by exactly the blocks in
// records-drift.expected.json and keep their attributes; the added functions are exactly the declared ones,
// granted to clinic_app only where the app calls them; no existing policy changed; one approval type added.
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/db/migrate";
import { migrationsUpTo } from "./migrations-up-to";
import { createHarness, type Harness } from "../rls/harness";

const BEFORE_TAG = "0070_examinations";
const AFTER_TAG = "0071_records";
type Fn = { def: string; volatile: string; secdef: boolean; config: string | null; acl: string | null };
type Block = { at: number; old: string; new: string };

let h: Harness;
let before: Map<string, Fn>;
let after: Map<string, Fn>;
let policiesBefore: Map<string, string>;
let policiesAfter: Map<string, string>;
let typesBefore: string[];
let typesAfter: string[];
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
const types = async (db: pg.ClientBase) => (await db.query<{ k: string }>(`select key || ':' || array_to_string(approver_roles, ',') as k from approval_types order by key`)).rows.map((r) => r.k);

// Applies the blocks in order to `def`: each replaces the old lines starting at 0-based line `at` of the old
// definition (`old` empty = a pure insertion before that line). Null when an old block does not match exactly.
function apply(def: string, blocks: Block[]): string | null {
  const lines = def.trimEnd().split("\n");
  const out: string[] = [];
  let i = 0;
  for (const b of blocks) {
    if (b.at < i) return null;
    while (i < b.at) out.push(lines[i++]);
    for (const o of b.old === "" ? [] : b.old.split("\n")) if (lines[i++] !== o) return null;
    if (b.new !== "") out.push(...b.new.split("\n"));
  }
  while (i < lines.length) out.push(lines[i++]);
  return out.join("\n");
}

beforeAll(async () => {
  const toBefore = migrationsUpTo(BEFORE_TAG);
  const toAfter = migrationsUpTo(AFTER_TAG);
  dirs = [toBefore, toAfter];
  let url = "";
  h = await createHarness({ migrate: async (u) => { url = u; await runMigrations(u, { folder: toBefore }); } });
  before = await capture(h.admin);
  policiesBefore = await policies(h.admin);
  typesBefore = await types(h.admin);
  await runMigrations(url, { folder: toAfter });
  after = await capture(h.admin);
  policiesAfter = await policies(h.admin);
  typesAfter = await types(h.admin);
}, 300_000);

afterAll(async () => {
  await h?.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("T-053: the records migration re-creates only examinations_guard and exam_sheet", () => {
  it("no existing function changed or dropped except the two, each by its exact blocks", () => {
    const expected = JSON.parse(readFileSync(join(import.meta.dirname, "records-drift.expected.json"), "utf8")) as Record<string, Block[]>;
    const changed: string[] = [];
    for (const [k, a] of after) {
      const b = before.get(k);
      if (!b) continue;
      if (b.def !== a.def) changed.push(k);
      expect({ k, volatile: a.volatile, secdef: a.secdef, config: a.config, acl: a.acl }).toEqual({ k, volatile: b.volatile, secdef: b.secdef, config: b.config, acl: b.acl });
    }
    expect(changed.sort()).toEqual(["exam_sheet(uuid)", "examinations_guard()"]);
    expect(Object.keys(expected).sort()).toEqual(["exam_sheet(uuid)", "examinations_guard()"]);
    for (const [k, blocks] of Object.entries(expected)) expect(apply(before.get(k)!.def, blocks), k).toBe(after.get(k)!.def.trimEnd());
    expect([...before.keys()].filter((k) => !after.has(k))).toEqual([]);
  });

  it("the added functions are the record ones; only the writers and readers are granted to clinic_app", () => {
    const added = [...after.keys()].filter((k) => !before.has(k)).sort();
    const app = ["record_sign(uuid)", "record_correct(uuid,jsonb,text)", "record_get(uuid)", "record_copy_request(uuid,text)", "record_copy_data(uuid)",
      "retention_until(uuid)", "copy_request_readable(uuid,uuid)"];
    const internal = ["records_guard()", "record_correction_sync()", "record_content(examinations)", "record_hash(jsonb)", "record_apply(jsonb,jsonb)",
      "record_delta(jsonb,jsonb)", "record_current(uuid,uuid)", "record_write_version(examinations,jsonb,text,uuid,text,uuid)", "record_copy_rows(uuid,uuid)",
      "record_copy_actor()"];
    expect(added).toEqual([...app, ...internal].sort());
    for (const k of added) {
      const acl = after.get(k)!.acl ?? "";
      expect(after.get(k)!.acl, k).not.toBeNull();
      if (app.includes(k)) expect(acl, k).toMatch(/clinic_app=X\//);
      else expect(acl, k).not.toMatch(/clinic_(app|vendor|executor|operator)=X\//);
      expect(acl, k).not.toMatch(/[{,]=X\//);
    }
  });

  it("no existing policy changed; one approval type added for late corrections", () => {
    for (const [k, v] of policiesBefore) expect(policiesAfter.get(k), k).toBe(v);
    expect(typesAfter.filter((t) => !typesBefore.includes(t))).toEqual(["record_late_correction:records_officer,facility_head"]);
    expect(typesBefore.filter((t) => !typesAfter.includes(t))).toEqual([]);
  });
});
