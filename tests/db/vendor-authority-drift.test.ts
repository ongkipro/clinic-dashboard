// HYG-008b drift check: 0049 re-creates functions from their latest definitions with only the
// planned lines changed. A database is migrated to exactly 0048 (a copy of drizzle/ that ends
// there), every public function body is captured, then to exactly 0049 and each body is compared
// again (the 0047->0048 proof is tests/db/authority-drift.test.ts, unchanged by 0049). Each
// change must equal the expected removed/added lines in vendor-authority-drift.expected.json; every
// other function must be byte-identical, and signatures, volatility, SECURITY DEFINER,
// search_path and grants (proacl) must not change.
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MIGRATIONS_FOLDER, runMigrations } from "../../src/db/migrate";
import { migrationsUpTo } from "./migrations-up-to";
import { createHarness, type Harness } from "../rls/harness";

const BEFORE_TAG = "0048_clinic_authority_wall_clock";
const AFTER_TAG = "0049_vendor_authority_wall_clock";
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

// Line-level difference (multiset): removed and added lines, trimmed of trailing space.
function lineDiff(a: string, b: string): { removed: string[]; added: string[] } {
  const al = a.split("\n").map((l) => l.trimEnd());
  const bl = b.split("\n").map((l) => l.trimEnd());
  const count = (xs: string[]) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>());
  const ca = count(al);
  const cb = count(bl);
  const removed: string[] = [];
  const added: string[] = [];
  for (const [l, k] of ca) for (let i = (cb.get(l) ?? 0); i < k; i++) removed.push(l);
  for (const [l, k] of cb) for (let i = (ca.get(l) ?? 0); i < k; i++) added.push(l);
  return { removed: removed.sort(), added: added.sort() };
}

beforeAll(async () => {
  const to0048 = migrationsUpTo(BEFORE_TAG);
  const to0049 = migrationsUpTo(AFTER_TAG);
  dirs = [to0048, to0049];
  let url = "";
  h = await createHarness({ migrate: async (u) => { url = u; await runMigrations(u, { folder: to0048 }); } });
  before = await capture(h.admin);
  await runMigrations(url, { folder: to0049 });
  after = await capture(h.admin);
}, 300_000);

afterAll(async () => {
  await h?.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("HYG-008b: 0049 changes only the planned lines", () => {
  it("runMigrations defaults to drizzle/", () => {
    expect(MIGRATIONS_FOLDER.endsWith("/drizzle")).toBe(true);
  });

  it("every changed function matches its expected diff; nothing else changed", () => {
    const expected = JSON.parse(readFileSync(join(import.meta.dirname, "vendor-authority-drift.expected.json"), "utf8")) as Record<string, { removed: string[]; added: string[] }>;
    const changed: Record<string, { removed: string[]; added: string[] }> = {};
    for (const [k, a] of after) {
      const b = before.get(k);
      if (!b) continue;
      if (b.def !== a.def) changed[k] = lineDiff(b.def, a.def);
      // Signature, volatility, definer, search_path and grants never change on a re-create. (Freshness
      // after a wait comes from the VOLATILE callers: each statement of vendor_authority_recheck and
      // operator_row_read takes a new snapshot, so a STABLE function they call reads it.)
      expect({ k, volatile: a.volatile, secdef: a.secdef, config: a.config, acl: a.acl }).toEqual({ k, volatile: b.volatile, secdef: b.secdef, config: b.config, acl: b.acl });
    }
    if (process.env.HYG008B_WRITE_EXPECTED) {
      writeFileSync(join(import.meta.dirname, "vendor-authority-drift.expected.json"), JSON.stringify(changed, null, 2) + "\n");
    }
    expect(changed).toEqual(expected);
  });

  it("new functions: the re-check, the refusal logger and vendor_staff_update_checked, with their declared shape", () => {
    const added = [...after.keys()].filter((k) => !before.has(k)).sort();
    expect(added).toEqual([
      "vendor_authority_recheck(text,text,text[],interval)",
      "vendor_authority_refused(text,text,text,text,uuid,uuid,text)",
      "vendor_staff_update_checked(text,uuid,text,timestamp with time zone,uuid,text[],text)",
    ]);
    expect(after.get("vendor_authority_recheck(text,text,text[],interval)")).toMatchObject({ volatile: "v", secdef: true });
    expect(after.get("vendor_authority_refused(text,text,text,text,uuid,uuid,text)")).toMatchObject({ volatile: "v", secdef: true });
    // The re-check and the checked update: owner only (definers call them). The logger: clinic_vendor.
    for (const k of ["vendor_authority_recheck(text,text,text[],interval)", "vendor_staff_update_checked(text,uuid,text,timestamp with time zone,uuid,text[],text)"]) {
      expect(after.get(k)!.acl, k).toMatch(/^\{\w+=X\/\w+\}$/);
    }
    expect(after.get("vendor_authority_refused(text,text,text,text,uuid,uuid,text)")!.acl).toMatch(/clinic_vendor=X\//);
    expect(after.get("vendor_authority_refused(text,text,text,text,uuid,uuid,text)")!.acl).not.toMatch(/[{,]=X\//);
  });

  it("no function was dropped", () => {
    expect([...before.keys()].filter((k) => !after.has(k))).toEqual([]);
  });
});
