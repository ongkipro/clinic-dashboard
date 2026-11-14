// T-085 drift check: the shift migration (0101) adds cash_shifts, cash_shift_counts and cash_shift_count_lines, a nullable shift_id with a
// same-branch FK on payments, booking_deposits and refunds, the stamping triggers (payments_shift, booking_deposits_shift, refunds_shift)
// and the variance routing trigger on approvals, and re-creates exactly refund_request (its positional refunds row gains the trailing
// shift_id). Every guard and payment writer stays byte-identical. A database is migrated to exactly 0100, then to exactly 0101 and
// compared (sha-256 in shifts-drift.expected.json).
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
  const toBefore = migrationsUpTo("0100_expenses");
  const toAfter = migrationsUpTo("0101_cash_shifts");
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

const CHANGED = ["refund_request(text,uuid,jsonb)"];

describe("T-085: the shift migration re-creates only refund_request", () => {
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
    const file = join(import.meta.dirname, "shifts-drift.expected.json");
    if (process.env.T085_WRITE_EXPECTED) {
      writeFileSync(file, JSON.stringify({ before: Object.fromEntries(CHANGED.map((k) => [k, sha(before.get(k)!.def)])),
        after: Object.fromEntries(CHANGED.map((k) => [k, sha(after.get(k)!.def)])) }, null, 2) + "\n");
    }
    const expected = JSON.parse(readFileSync(file, "utf8")) as { before: Record<string, string>; after: Record<string, string> };
    for (const k of CHANGED) expect(sha(before.get(k)!.def), `${k} before`).toBe(expected.before[k]);
    for (const k of CHANGED) expect(sha(after.get(k)!.def), `${k} after`).toBe(expected.after[k]);
  });

  it("the added functions are the shift ones; only the writers, readers, the inbox helper and the RLS predicate are granted", () => {
    const added = [...after.keys()].filter((k) => !before.has(k)).sort();
    const app = ["approval_manager_decides_shift(uuid)", "cash_shift_get(uuid)", "cash_shift_list(uuid,text)", "cash_shift_mine(uuid)",
      "cash_shift_open(text,uuid,jsonb)", "cash_shift_readable(uuid,uuid,uuid)", "cash_shift_submit(text,uuid,jsonb)"];
    const internal = ["booking_deposits_shift()", "cash_shift_counts_guard()", "cash_shift_expected(uuid,uuid)",
      "cash_shift_for(uuid,uuid,uuid,text,timestamp with time zone,boolean)", "cash_shift_sync()", "cash_shifts_guard()", "payments_shift()", "refunds_shift()"];
    expect(added).toEqual([...app, ...internal].sort());
    for (const k of added) {
      const acl = after.get(k)!.acl ?? "";
      expect(after.get(k)!.acl, k).not.toBeNull();
      if (app.includes(k)) expect(acl, k).toMatch(/clinic_app=X\//);
      else expect(acl, k).not.toMatch(/clinic_(app|vendor|executor|operator)=X\//);
      expect(acl, k).not.toMatch(/[{,]=X\//);
    }
  });

  it("no existing policy or check changed; the three same-branch shift FKs added", () => {
    for (const [k, v] of policiesBefore) expect(policiesAfter.get(k), k).toBe(v);
    expect([...checksBefore.keys()].filter((k) => checksAfter.get(k) !== checksBefore.get(k))).toEqual([]);
    for (const t of ["payments", "booking_deposits", "refunds"]) {
      expect(checksAfter.get(`${t}.${t}_shift_fk`), t).toContain("REFERENCES cash_shifts(tenant_id, branch_id, id)");
    }
  });

  it("the three tables are RLS-protected, never truncated, guards and stamping triggers enabled always; the count reason never granted", async () => {
    const rls = (await h.admin.query(`select relname, relrowsecurity from pg_class where relname in ('cash_shifts','cash_shift_counts','cash_shift_count_lines') order by relname`)).rows;
    expect(rls.map((r) => [r.relname, r.relrowsecurity])).toEqual([["cash_shift_count_lines", true], ["cash_shift_counts", true], ["cash_shifts", true]]);
    const t = (await h.admin.query(`select tgname, tgenabled from pg_trigger where tgname in ('cash_shifts_guard','cash_shifts_no_truncate','cash_shift_counts_guard',
      'cash_shift_counts_no_truncate','cash_shift_count_lines_insert_only','cash_shift_count_lines_no_truncate','payments_shift','booking_deposits_shift','refunds_shift',
      'approvals_cash_shift_sync') order by tgname`)).rows;
    expect(t.map((x) => [x.tgname, x.tgenabled])).toEqual([["approvals_cash_shift_sync", "A"], ["booking_deposits_shift", "A"], ["cash_shift_count_lines_insert_only", "A"],
      ["cash_shift_count_lines_no_truncate", "A"], ["cash_shift_counts_guard", "A"], ["cash_shift_counts_no_truncate", "A"], ["cash_shifts_guard", "A"],
      ["cash_shifts_no_truncate", "A"], ["payments_shift", "A"], ["refunds_shift", "A"]]);
    const g = (await h.admin.query(`select has_column_privilege('clinic_app', 'public.cash_shift_counts', 'reason', 'SELECT') r,
                                           has_column_privilege('clinic_operator', 'public.cash_shift_counts', 'reason', 'SELECT') o,
                                           has_column_privilege('clinic_app', 'public.refunds', 'shift_id', 'SELECT') s,
                                           has_column_privilege('clinic_app', 'public.payments', 'shift_id', 'SELECT') p,
                                           has_table_privilege('clinic_app', 'public.cash_shifts', 'INSERT') i`)).rows[0];
    expect([g.r, g.o, g.s, g.p, g.i]).toEqual([false, false, true, true, false]);
  });
});
