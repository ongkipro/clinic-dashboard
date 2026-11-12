// T-067 drift check (plan): the payables migration (0084) adds its tables, triggers and functions and
// re-creates nothing; it adds one constraint (T-066's credit expectations name their credit note). A database is migrated to exactly 0083, every public function, policy and constraint captured,
// then to exactly 0084 and compared: every existing function is byte-identical with its attributes; the added functions
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
  const toBefore = migrationsUpTo("0083_suppliers");
  const toAfter = migrationsUpTo("0084_payables");
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

describe("T-067: the payables migration re-creates nothing", () => {
  it("every existing function is byte-identical with its attributes; none dropped", () => {
    for (const [k, b] of before) {
      const a = after.get(k);
      expect(a, k).toBeDefined();
      expect({ k, ...a }).toEqual({ k, ...b });
    }
  });

  it("the added functions are the supplier ones; only the writers and readers are granted to clinic_app", () => {
    const added = [...after.keys()].filter((k) => !before.has(k)).sort();
    const app = ["po_save(text,uuid,jsonb)", "po_transition(uuid,text,text)", "goods_receipt_record(text,uuid,jsonb)", "supplier_invoice_record(text,uuid,jsonb)", "supplier_payment_record(text,uuid,jsonb)", "supplier_payment_allocate(text,uuid,jsonb)", "supplier_credit_note_record(text,uuid,jsonb)", "supplier_credit_apply(text,uuid,uuid,bigint)", "supplier_credit_expectation_write_off(uuid,text)", "supplier_payable_reverse(text,uuid,text)", "purchasing_context()", "po_list(uuid,text)", "po_get(uuid)", "goods_receipt_list(uuid,integer)", "payable_overview(uuid)"];
    const internal = ["po_next_number(uuid,uuid)", "payables_date(text)", "payables_money(jsonb)", "payables_grni(supplier_receipts)", "payables_allocate(supplier_payments,uuid,bigint,text)", "payables_allocate_many(supplier_payments,jsonb,text)", "purchase_orders_guard()", "purchase_order_lines_guard()", "payables_rows_insert_only()", "supplier_invoices_guard()", "supplier_invoices_total_check()", "supplier_invoice_lines_guard()", "supplier_payments_guard()", "supplier_credit_notes_guard()", "supplier_settlements_guard()", "po_locked(uuid,uuid,uuid)", "payables_actor(text[],uuid)", "po_json(purchase_orders,boolean)", "goods_receipt_json(goods_receipts)", "supplier_balance_json(uuid,uuid,uuid)"];
    expect(added).toEqual([...app, ...internal].sort());
    for (const k of added) {
      const acl = after.get(k)!.acl ?? "";
      expect(after.get(k)!.acl, k).not.toBeNull();
      if (app.includes(k)) expect(acl, k).toMatch(/clinic_app=X\//);
      else expect(acl, k).not.toMatch(/clinic_(app|vendor|executor|operator)=X\//);
      expect(acl, k).not.toMatch(/[{,]=X\//);
    }
  });

  it("no existing policy or constraint changed or dropped; the one added constraint on an existing table is the expectation's credit-note link", () => {
    for (const [k, v] of policiesBefore) expect(policiesAfter.get(k), k).toBe(v);
    for (const [k, v] of checksBefore) expect(checksAfter.get(k), k).toBe(v);
    const existing = new Set([...checksBefore.keys()].map((k) => k.split(".")[0]));
    const addedOnExisting = [...checksAfter.keys()].filter((k) => !checksBefore.has(k) && existing.has(k.split(".")[0]));
    expect(addedOnExisting).toEqual(["supplier_credit_expectations.supplier_credit_expectations_credit_note_fk"]);
  });

  it("the new triggers are enabled always", async () => {
    const t = (await h.admin.query(`select tgname, tgenabled from pg_trigger where tgname in ('purchase_orders_guard','purchase_order_lines_guard','goods_receipts_guard',
      'supplier_invoices_guard','supplier_invoices_total_check','supplier_invoice_lines_guard','supplier_payments_guard','supplier_credit_notes_guard',
      'supplier_payment_allocations_guard','supplier_credit_applications_guard') order by tgname`)).rows;
    expect(t).toHaveLength(10);
    expect(t.every((x) => x.tgenabled === "A")).toBe(true);
  });
});
