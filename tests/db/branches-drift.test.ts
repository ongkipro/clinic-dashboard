// T-036 drift check: the branch master migration adds its tables and functions and changes nothing that exists.
// A database is migrated to exactly 0055, every public function and the approvals policy captured,
// then to exactly 0056 and compared: every existing function stays byte-identical (definition,
// volatility, SECURITY DEFINER, search_path, grants); the added functions are exactly the declared
// ones, granted to clinic_app only where the app calls them.
import { rmSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/db/migrate";
import { migrationsUpTo } from "./migrations-up-to";
import { createHarness, type Harness } from "../rls/harness";

const BEFORE_TAG = "0057_patients";
const AFTER_TAG = "0058_branch_master";
type Fn = { def: string; volatile: string; secdef: boolean; config: string | null; acl: string | null };
type Block = { at: number; old: string; new: string };

let h: Harness;
let before: Map<string, Fn>;
let after: Map<string, Fn>;
let dirs: string[] = [];
let policyBefore = "";
let policyAfter = "";
const policy = async (db: pg.ClientBase) =>
  (await db.query<{ q: string }>(`select pg_get_expr(polqual, polrelid) as q from pg_policy where polrelid = 'public.approvals'::regclass and polname = 'approvals_read'`)).rows[0].q;

async function capture(db: pg.ClientBase): Promise<Map<string, Fn>> {
  const r = await db.query<{ k: string; def: string; volatile: string; secdef: boolean; config: string[] | null; acl: string | null }>(
    `select p.oid::regprocedure::text as k, pg_get_functiondef(p.oid) as def, p.provolatile as volatile, p.prosecdef as secdef,
            p.proconfig as config, p.proacl::text as acl
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind = 'f'`,
  );
  return new Map(r.rows.map((x) => [x.k, { def: x.def, volatile: x.volatile, secdef: x.secdef, config: x.config?.join(";") ?? null, acl: x.acl }]));
}

// Applies the blocks in order to `def`: each replaces the old lines starting at 0-based line `at` of
// the old definition (`old` empty = a pure insertion before that line). Returns null when an old
// block does not match exactly at its position, so a moved or reordered line fails.
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
  policyBefore = await policy(h.admin);
  await runMigrations(url, { folder: toAfter });
  after = await capture(h.admin);
  policyAfter = await policy(h.admin);
}, 300_000);

afterAll(async () => {
  await h?.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("T-036: the branch master migration changes no existing function", () => {
  it("no existing function changed or dropped", () => {
    const expected: Record<string, Block[]> = {};
    const changed: string[] = [];
    for (const [k, a] of after) {
      const b = before.get(k);
      if (!b) continue;
      if (b.def !== a.def) changed.push(k);
      expect({ k, volatile: a.volatile, secdef: a.secdef, config: a.config, acl: a.acl }).toEqual({ k, volatile: b.volatile, secdef: b.secdef, config: b.config, acl: b.acl });
    }
    expect(changed.sort()).toEqual(Object.keys(expected).sort());
    for (const [k, blocks] of Object.entries(expected)) {
      expect(apply(before.get(k)!.def, blocks), k).toBe(after.get(k)!.def.trimEnd());
    }
    expect([...before.keys()].filter((k) => !after.has(k))).toEqual([]);
  });

  it("the added functions are exactly the branch master ones; granted to clinic_app only where called by the app", () => {
    const added = [...after.keys()].filter((k) => !before.has(k)).sort();
    const app = [
      "branch_closure_add(uuid,date,time without time zone,time without time zone,text)", "branch_closure_remove(uuid)", "branch_create(text,text,text)",
      "branch_is_open(uuid,timestamp with time zone,timestamp with time zone)", "branch_set_hours(uuid,jsonb)", "branch_set_services(uuid,uuid[])",
      "branch_update_profile(uuid,jsonb)", "device_set_active(uuid,boolean)", "device_upsert(uuid,uuid,text,text)", "room_set_active(uuid,boolean)",
      "room_upsert(uuid,uuid,text,text,text)",
    ];
    expect(added).toEqual([...app, "branch_authorize(uuid,uuid,text,uuid,boolean)", "branch_changed(uuid,text,text,uuid)", "branch_closures_guard()",
      "branch_resources_guard()", "branch_services_guard()", "branches_guard()"].sort());
    for (const k of added) {
      const acl = after.get(k)!.acl ?? "";
      if (app.includes(k)) expect(acl, k).toMatch(/clinic_app=X\//);
      else expect(acl, k).not.toMatch(/clinic_(app|vendor|executor)=X\//);
      expect(acl, k).not.toMatch(/[{,]=X\//);
    }
  });

  it("approvals_read is unchanged", () => {
    expect(policyAfter).toBe(policyBefore);
  });
});
