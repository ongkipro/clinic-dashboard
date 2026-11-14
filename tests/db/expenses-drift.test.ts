// T-084 drift check: the expenses migration (0100) adds expense_categories and expenses, the expense invoice FK and pairing check,
// replaces supplier_invoices_check (an expense invoice recorded by owner, finance or manager), and re-creates exactly
// supplier_payable_reverse (refuses an expense invoice) and supplier_invoices_total_check (an expense invoice equals its expense; now a
// definer). A database is migrated to exactly 0099, then to exactly 0100 and compared (sha-256 in expenses-drift.expected.json).
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
  const toBefore = migrationsUpTo("0099_instalment_schedules");
  const toAfter = migrationsUpTo("0100_expenses");
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

const CHANGED = ["supplier_invoices_total_check()", "supplier_payable_reverse(text,uuid,text)"].sort();
const SECDEF_NOW = ["supplier_invoices_total_check()"];

describe("T-084: the expenses migration re-creates only the declared functions", () => {
  it("the changed ones are exactly the declared set, attributes kept (the total check now a definer); nothing dropped", () => {
    const changed: string[] = [];
    for (const [k, a] of after) {
      const b = before.get(k);
      if (!b) continue;
      if (b.def !== a.def) changed.push(k);
      expect({ k, volatile: a.volatile, secdef: a.secdef, config: a.config, acl: a.acl })
        .toEqual({ k, volatile: b.volatile, secdef: SECDEF_NOW.includes(k) ? true : b.secdef, config: b.config, acl: b.acl });
    }
    expect(changed.sort()).toEqual(CHANGED);
    expect([...before.keys()].filter((x) => !after.has(x))).toEqual([]);
    const file = join(import.meta.dirname, "expenses-drift.expected.json");
    if (process.env.T084_WRITE_EXPECTED) {
      writeFileSync(file, JSON.stringify({ before: Object.fromEntries(CHANGED.map((k) => [k, sha(before.get(k)!.def)])),
        after: Object.fromEntries(CHANGED.map((k) => [k, sha(after.get(k)!.def)])) }, null, 2) + "\n");
    }
    const expected = JSON.parse(readFileSync(file, "utf8")) as { before: Record<string, string>; after: Record<string, string> };
    for (const k of CHANGED) expect(sha(before.get(k)!.def), `${k} before`).toBe(expected.before[k]);
    for (const k of CHANGED) expect(sha(after.get(k)!.def), `${k} after`).toBe(expected.after[k]);
  });

  it("the added functions are the expense ones; only the writers, readers and RLS predicates are granted", () => {
    const added = [...after.keys()].filter((k) => !before.has(k)).sort();
    const app = ["expense_branch_totals(date,date)", "expense_category_readable(uuid)", "expense_category_save(uuid,jsonb)", "expense_readable(uuid,uuid)",
      "expense_receipt(uuid)", "expense_record(text,uuid,jsonb,bytea)", "expense_reverse(uuid,text)", "expenses_list(uuid,date,date,uuid,text)"];
    const internal = ["expense_categories_guard()", "expense_reader(uuid)", "expenses_guard()", "expenses_payable_check()"];
    expect(added).toEqual([...app, ...internal].sort());
    for (const k of added) {
      const acl = after.get(k)!.acl ?? "";
      expect(after.get(k)!.acl, k).not.toBeNull();
      if (app.includes(k)) expect(acl, k).toMatch(/clinic_app=X\//);
      else expect(acl, k).not.toMatch(/clinic_(app|vendor|executor|operator)=X\//);
      expect(acl, k).not.toMatch(/[{,]=X\//);
    }
  });

  it("only supplier_invoices_check changed (purchase: purchasing or finance; expense: owner, finance or manager); the expense FK added", () => {
    for (const [k, v] of policiesBefore) expect(policiesAfter.get(k), k).toBe(v);
    expect([...checksBefore.keys()].filter((k) => checksAfter.get(k) !== checksBefore.get(k))).toEqual(["supplier_invoices.supplier_invoices_check"]);
    const c = checksAfter.get("supplier_invoices.supplier_invoices_check")!;
    expect(c).toContain("'expense'");
    expect(c).toContain("'manager'");
    expect(checksAfter.get("supplier_invoices.supplier_invoices_expense_fk")).toContain("REFERENCES expenses(tenant_id, id)");
  });

  it("the two tables are RLS-protected, never truncated, guards and the pairing check enabled always; the receipt bytes never granted", async () => {
    const rls = (await h.admin.query(`select relname, relrowsecurity from pg_class where relname in ('expense_categories','expenses') order by relname`)).rows;
    expect(rls.map((r) => [r.relname, r.relrowsecurity])).toEqual([["expense_categories", true], ["expenses", true]]);
    const t = (await h.admin.query(`select tgname, tgenabled, tgdeferrable from pg_trigger where tgname in ('expense_categories_guard','expense_categories_no_truncate',
                                    'expenses_guard','expenses_no_truncate','expenses_payable_check','supplier_invoices_total_check') order by tgname`)).rows;
    expect(t.map((x) => [x.tgname, x.tgenabled, x.tgdeferrable])).toEqual([["expense_categories_guard", "A", false], ["expense_categories_no_truncate", "A", false],
      ["expenses_guard", "A", false], ["expenses_no_truncate", "A", false], ["expenses_payable_check", "A", true], ["supplier_invoices_total_check", "A", true]]);
    const g = (await h.admin.query(`select has_column_privilege('clinic_app', 'public.expenses', 'receipt_content', 'SELECT') b,
                                           has_column_privilege('clinic_operator', 'public.expenses', 'receipt_content', 'SELECT') o,
                                           has_column_privilege('clinic_app', 'public.expenses', 'receipt_sha256', 'SELECT') s,
                                           has_table_privilege('clinic_app', 'public.expenses', 'INSERT') i`)).rows[0];
    expect([g.b, g.o, g.s, g.i]).toEqual([false, false, true, false]);
  });
});
