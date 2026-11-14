// T-082 drift check: the package sharing migration (0098) adds package_sharing and package_beneficiaries, packages.sharing_allowed
// and package_sessions.beneficiary_patient_id (backfilled for reserved and redeemed sessions), and re-creates exactly the declared
// package functions, each with its signature and attributes. A database is migrated to exactly 0097, then to exactly 0098 and compared
// (sha-256 in package-sharing-drift.expected.json).
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
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
const sha = (s: string) => createHash("sha256").update(s.trimEnd()).digest("hex");

beforeAll(async () => {
  const toBefore = migrationsUpTo("0097_promo");
  const toAfter = migrationsUpTo("0098_package_sharing");
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

const CHANGED = [
  "package_close_do(packages,text,text,uuid,text,timestamp with time zone)", "package_execution_finish()", "package_open(invoices,uuid,text,timestamp with time zone)",
  "package_patient_get(uuid)", "package_reserve(text,uuid,uuid,jsonb)", "package_row(packages)", "package_session_back(package_sessions,uuid,text,uuid,text)",
  "package_sessions_guard()", "packages_guard()",
].sort();

describe("T-082: the package sharing migration re-creates only the declared functions", () => {
  it("the changed ones are exactly the declared set, attributes kept; nothing dropped", () => {
    const changed: string[] = [];
    for (const [k, a] of after) {
      const b = before.get(k);
      if (!b) continue;
      if (b.def !== a.def) changed.push(k);
      expect({ k, volatile: a.volatile, secdef: a.secdef, config: a.config, acl: a.acl }).toEqual({ k, volatile: b.volatile, secdef: b.secdef, config: b.config, acl: b.acl });
    }
    expect(changed.sort()).toEqual(CHANGED);
    expect([...before.keys()].filter((x) => !after.has(x))).toEqual([]);
    const file = join(import.meta.dirname, "package-sharing-drift.expected.json");
    if (process.env.T082_WRITE_EXPECTED) {
      writeFileSync(file, JSON.stringify({ before: Object.fromEntries(CHANGED.map((k) => [k, sha(before.get(k)!.def)])),
        after: Object.fromEntries(CHANGED.map((k) => [k, sha(after.get(k)!.def)])) }, null, 2) + "\n");
    }
    const expected = JSON.parse(readFileSync(file, "utf8")) as { before: Record<string, string>; after: Record<string, string> };
    for (const k of CHANGED) expect(sha(before.get(k)!.def), `${k} before`).toBe(expected.before[k]);
    for (const k of CHANGED) expect(sha(after.get(k)!.def), `${k} after`).toBe(expected.after[k]);
  });

  it("the added functions are the sharing ones; only the switch, its reader and the beneficiary writers are granted", () => {
    const added = [...after.keys()].filter((k) => !before.has(k)).sort();
    const app = ["package_beneficiary_add(text,uuid,uuid,text)", "package_beneficiary_remove(uuid,text)", "package_sharing_get(uuid)", "package_sharing_set(uuid,boolean,text)"];
    const internal = ["package_beneficiaries_guard()", "package_beneficiary_active(uuid,uuid,uuid)", "package_patient_may_use(uuid,uuid,uuid)",
      "package_sharing_at(uuid,uuid,timestamp with time zone)", "package_sharing_guard()"];
    expect(added).toEqual([...app, ...internal].sort());
    for (const k of added) {
      const acl = after.get(k)!.acl ?? "";
      expect(after.get(k)!.acl, k).not.toBeNull();
      if (app.includes(k)) expect(acl, k).toMatch(/clinic_app=X\//);
      else expect(acl, k).not.toMatch(/clinic_(app|vendor|executor|operator)=X\//);
      expect(acl, k).not.toMatch(/[{,]=X\//);
    }
  });

  it("no existing policy or check changed; the session check and the FKs added", () => {
    for (const [k, v] of policiesBefore) expect(policiesAfter.get(k), k).toBe(v);
    expect([...checksBefore.keys()].filter((k) => checksAfter.get(k) !== checksBefore.get(k))).toEqual([]);
    expect(checksAfter.get("package_sessions.package_sessions_beneficiary_check")).toContain("beneficiary_patient_id");
    expect(checksAfter.get("package_sessions.package_sessions_beneficiary_fk")).toContain("REFERENCES patients");
  });

  it("the two tables are RLS-protected, never truncated, guards enabled always; the column grant on packages", async () => {
    const rls = (await h.admin.query(`select relname, relrowsecurity from pg_class where relname in ('package_sharing','package_beneficiaries') order by relname`)).rows;
    expect(rls.map((r) => [r.relname, r.relrowsecurity])).toEqual([["package_beneficiaries", true], ["package_sharing", true]]);
    const t = (await h.admin.query(`select tgname, tgenabled from pg_trigger where tgname in ('package_sharing_guard','package_sharing_no_truncate',
                                    'package_beneficiaries_guard','package_beneficiaries_no_truncate','package_sessions_guard') order by tgname`)).rows;
    expect(t.map((x) => [x.tgname, x.tgenabled])).toEqual([["package_beneficiaries_guard", "A"], ["package_beneficiaries_no_truncate", "A"],
      ["package_sessions_guard", "A"], ["package_sharing_guard", "A"], ["package_sharing_no_truncate", "A"]]);
    const g = (await h.admin.query(`select has_column_privilege('clinic_app', 'public.packages', 'sharing_allowed', 'SELECT') a,
                                           has_column_privilege('clinic_app', 'public.package_beneficiaries', 'grant_reason', 'SELECT') r`)).rows[0];
    expect([g.a, g.r]).toEqual([true, false]);
  });
});
