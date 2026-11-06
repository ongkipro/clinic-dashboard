// HYG-009 drift check: 0050 re-creates setting_set from its latest definition (0048; 0049 does
// not touch it) with only its two branch checks changed. A database is migrated to exactly 0049,
// every public function is captured, then to exactly 0050 and compared: setting_set must equal its
// old definition with the one block in setting-scope-drift.expected.json replaced, and nothing else
// may change (bodies, signatures, volatility, SECURITY DEFINER, search_path, grants).
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/db/migrate";
import { migrationsUpTo } from "./migrations-up-to";
import { createHarness, type Harness } from "../rls/harness";

const BEFORE_TAG = "0049_vendor_authority_wall_clock";
const AFTER_TAG = "0050_setting_branch_scope";
type Fn = { def: string; volatile: string; secdef: boolean; config: string | null; acl: string | null };

let h: Harness;
let before: Map<string, Fn>;
let after: Map<string, Fn>;
let dirs: string[] = [];

async function capture(db: pg.ClientBase): Promise<Map<string, Fn>> {
  const r = await db.query<{ k: string; def: string; volatile: string; secdef: boolean; config: string[] | null; acl: string | null }>(
    `select p.oid::regprocedure::text as k, pg_get_functiondef(p.oid) as def, p.provolatile as volatile, p.prosecdef as secdef,
            p.proconfig as config, p.proacl::text as acl
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind = 'f'`,
  );
  return new Map(r.rows.map((x) => [x.k, { def: x.def, volatile: x.volatile, secdef: x.secdef, config: x.config?.join(";") ?? null, acl: x.acl }]));
}

beforeAll(async () => {
  const toBefore = migrationsUpTo(BEFORE_TAG);
  const toAfter = migrationsUpTo(AFTER_TAG);
  dirs = [toBefore, toAfter];
  let url = "";
  h = await createHarness({ migrate: async (u) => { url = u; await runMigrations(u, { folder: toBefore }); } });
  before = await capture(h.admin);
  await runMigrations(url, { folder: toAfter });
  after = await capture(h.admin);
}, 300_000);

afterAll(async () => {
  await h?.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("HYG-009: 0050 changes only setting_set's branch checks", () => {
  it("setting_set equals its 0049 definition with exactly the planned block replaced; nothing else changed, added or dropped", () => {
    // Order-sensitive: the whole new definition must equal the old one with one exact, contiguous
    // replacement (review P2: a line multiset would not see reordered authorization checks).
    const expected = JSON.parse(readFileSync(join(import.meta.dirname, "setting-scope-drift.expected.json"), "utf8")) as Record<string, { old: string; new: string }>;
    const changed: string[] = [];
    for (const [k, a] of after) {
      const b = before.get(k);
      if (!b) continue;
      if (b.def !== a.def) changed.push(k);
      expect({ k, volatile: a.volatile, secdef: a.secdef, config: a.config, acl: a.acl }).toEqual({ k, volatile: b.volatile, secdef: b.secdef, config: b.config, acl: b.acl });
    }
    expect(changed).toEqual(Object.keys(expected));
    for (const [k, { old, new: replacement }] of Object.entries(expected)) {
      const b = before.get(k)!.def;
      expect(b.split(old).length - 1, k).toBe(1);
      expect(after.get(k)!.def, k).toBe(b.replace(old, replacement));
    }
    expect([...after.keys()].filter((k) => !before.has(k))).toEqual([]);
    expect([...before.keys()].filter((k) => !after.has(k))).toEqual([]);
  });
});
