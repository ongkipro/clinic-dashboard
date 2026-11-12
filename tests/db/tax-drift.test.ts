// T-071 drift check: the tax and invoice migration (0086) adds its tables, triggers and functions and re-creates
// nothing; on an existing table it adds only the tenants tax guard trigger. A database is migrated to exactly 0085,
// every public function, policy and constraint captured, then to exactly 0086 and compared: every existing function is byte-identical with its attributes; the added functions
// are the declared ones, granted to clinic_app only where the app calls them; no existing policy or constraint
// changed or dropped; the new triggers are enabled always.
import { rmSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/db/migrate";
import { migrationsUpTo } from "./migrations-up-to";
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
  const toBefore = migrationsUpTo("0085_safety");
  const toAfter = migrationsUpTo("0086_tax_invoice");
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

describe("T-071: the tax and invoice migration re-creates nothing", () => {
  it("every existing function is byte-identical with its attributes; none dropped", () => {
    for (const [k, b] of before) {
      const a = after.get(k);
      expect(a, k).toBeDefined();
      expect({ k, ...a }).toEqual({ k, ...b });
    }
  });

  it("the added functions are the tax and invoice ones; only the writers, readers and read predicates are granted to clinic_app", () => {
    const added = [...after.keys()].filter((k) => !before.has(k)).sort();
    const app = ["tax_profile_set(text,jsonb)", "tax_profile_get()", "invoice_open(text,uuid,jsonb)", "invoice_issue(text,uuid,jsonb)", "invoice_get(uuid)",
      "invoice_readable(uuid)", "tax_profile_readable(uuid)"];
    const internal = ["tax_local_date(uuid,timestamp with time zone,uuid)", "tax_pkp_at(uuid,timestamp with time zone,uuid)", "tax_vat_split(bigint,text,boolean)",
      "tax_turnover_12m(uuid,date)", "tax_latest_issued_date(uuid)", "tax_profile_changes_guard()", "tenants_tax_guard()", "invoices_guard()", "invoice_lines_guard()",
      "invoice_actor(uuid)", "invoice_line_snapshot(invoices,uuid,integer,bigint,timestamp with time zone)"];
    expect(added).toEqual([...app, ...internal].sort());
    for (const k of added) {
      const acl = after.get(k)!.acl ?? "";
      expect(after.get(k)!.acl, k).not.toBeNull();
      if (app.includes(k)) expect(acl, k).toMatch(/clinic_app=X\//);
      else expect(acl, k).not.toMatch(/clinic_(app|vendor|executor|operator)=X\//);
      expect(acl, k).not.toMatch(/[{,]=X\//);
    }
  });

  it("no existing policy or constraint changed or dropped; none added on an existing table", () => {
    for (const [k, v] of policiesBefore) expect(policiesAfter.get(k), k).toBe(v);
    for (const [k, v] of checksBefore) expect(checksAfter.get(k), k).toBe(v);
    const existing = new Set([...checksBefore.keys()].map((k) => k.split(".")[0]));
    expect([...checksAfter.keys()].filter((k) => !checksBefore.has(k) && existing.has(k.split(".")[0]))).toEqual([]);
  });

  it("the new triggers are enabled always, including the tenants tax guard", async () => {
    const t = (await h.admin.query(`select tgname, tgenabled from pg_trigger where tgname in ('tax_profile_changes_guard','tenants_tax_guard','invoices_guard','invoice_lines_guard',
      'tax_profile_changes_no_truncate','invoices_no_truncate','invoice_lines_no_truncate') order by tgname`)).rows;
    expect(t).toHaveLength(7);
    expect(t.every((x) => x.tgenabled === "A")).toBe(true);
  });
});
