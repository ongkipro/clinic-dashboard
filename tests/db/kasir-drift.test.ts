// T-072 drift check (plan §5, r1 P1-1/P1-2): the Kasir migration (0087) adds its tables, triggers and functions and
// re-creates exactly the declared existing functions — 0086's invoices_guard, invoice_open and invoice_issue (the counter
// flag, the visit lock, numbering, the counter dispensings) and 0082's dispensings_guard, dispensing_locked,
// dispensing_blocker, dispense_hand_over, dispense_cancel, pharmacy_dispensing_row, pharmacy_prep_list,
// pharmacy_handover_list and pharmacy_recall_trace (a counter-sale dispensing without a visit) — each keeping its
// signature and attributes. A database is migrated to exactly 0086, every public function, policy and constraint
// captured, then to exactly 0087 and compared: every other function stays byte-identical (sha-256 of both versions of
// the changed ones in kasir-drift.expected.json); the added functions are the declared ones, granted to clinic_app only
// where the app calls them; no existing policy changed or dropped; the changed constraints are the declared ones.
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
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
const sha = (s: string) => createHash("sha256").update(s.trimEnd()).digest("hex");

beforeAll(async () => {
  const toBefore = migrationsUpTo("0086_tax_invoice");
  const toAfter = migrationsUpTo("0087_kasir");
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
  "dispense_cancel(uuid,text)", "dispense_hand_over(text,uuid,jsonb)", "dispensing_blocker(dispensings)", "dispensing_locked(uuid,uuid,uuid)", "dispensings_guard()",
  "invoice_issue(text,uuid,jsonb)", "invoice_open(text,uuid,jsonb)", "invoices_guard()", "pharmacy_dispensing_row(dispensings)", "pharmacy_handover_list()",
  "pharmacy_prep_list()", "pharmacy_recall_trace(uuid)",
];

describe("T-072: the Kasir migration re-creates only the declared invoice and pharmacy functions", () => {
  it("no function dropped; the changed ones are exactly the declared set, from their reviewed 0086 to their reviewed 0087 definitions, attributes kept", () => {
    const changed: string[] = [];
    for (const [k, a] of after) {
      const b = before.get(k);
      if (!b) continue;
      if (b.def !== a.def) changed.push(k);
      expect({ k, volatile: a.volatile, secdef: a.secdef, config: a.config, acl: a.acl }).toEqual({ k, volatile: b.volatile, secdef: b.secdef, config: b.config, acl: b.acl });
    }
    expect(changed.sort()).toEqual(CHANGED);
    const file = join(import.meta.dirname, "kasir-drift.expected.json");
    if (process.env.T072_WRITE_EXPECTED) {
      writeFileSync(file, JSON.stringify({ before: Object.fromEntries(CHANGED.map((k) => [k, sha(before.get(k)!.def)])),
        after: Object.fromEntries(CHANGED.map((k) => [k, sha(after.get(k)!.def)])) }, null, 2) + "\n");
    }
    const expected = JSON.parse(readFileSync(file, "utf8")) as { before: Record<string, string>; after: Record<string, string> };
    for (const k of CHANGED) {
      expect(sha(before.get(k)!.def), `${k} before`).toBe(expected.before[k]);
      expect(sha(after.get(k)!.def), `${k} after`).toBe(expected.after[k]);
    }
    expect(after.get("dispense_hand_over(text,uuid,jsonb)")!.def).toContain("jsonb_strip_nulls");
    expect([...before.keys()].filter((x) => !after.has(x))).toEqual([]);
  });

  it("the added functions are the Kasir ones; only the writers, readers and read predicates are granted to clinic_app", () => {
    const added = [...after.keys()].filter((k) => !before.has(k)).sort();
    const app = [
      "payment_receive(text,uuid,jsonb)", "invoice_void_request(uuid,text)", "kasir_queue(uuid)", "kasir_invoice_get(uuid)", "kasir_visit_lines(uuid)",
      "kasir_counter_items(uuid,text)", "receipt_get(uuid)", "kasir_readable(uuid,uuid)", "approval_manager_decides_void(uuid)",
    ];
    const internal = [
      "kasir_actor()", "kasir_next_number(uuid,uuid,text)", "kasir_line_paid(uuid,uuid)", "kasir_outstanding(uuid,uuid)", "kasir_visit_payment(uuid,uuid)",
      "kasir_method_enabled(text,timestamp with time zone)", "kasir_patient_json(uuid,uuid,boolean)", "kasir_allocate(bigint,uuid[],bigint[])",
      "kasir_manager_may_void(uuid,uuid,timestamp with time zone)", "kasir_rows_insert_only()", "payments_guard()", "payment_allocations_guard()",
      "kasir_receipt_body(invoices,text,timestamp with time zone,jsonb)", "invoice_void_sync()", "pharmacy_dispensing_patient(dispensings)",
      "kasir_reader(uuid)", "kasir_invoice_row(invoices,boolean)",
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

  it("no existing policy changed or dropped; the changed constraints are the invoice and dispensing checks (counter, void)", () => {
    for (const [k, v] of policiesBefore) expect(policiesAfter.get(k), k).toBe(v);
    const changed = [...checksBefore].filter(([k, v]) => checksAfter.get(k) !== v).map(([k]) => k).sort();
    expect(changed).toEqual(["dispensings.dispensings_check", "invoices.invoices_check"]);
    // NOT NULL dropped only on the counter-sale dispensing's visit and patient
    expect(checksAfter.get("dispensings.dispensings_check")).toContain("invoice_line_id");
  });

  it("the new triggers are enabled always", async () => {
    const t = (await h.admin.query(`select tgname, tgenabled from pg_trigger where tgname in ('receipts_insert_only','payments_insert_only','payment_allocations_insert_only',
      'payments_guard','payment_allocations_guard','approvals_invoice_void_sync','receipts_no_truncate','payments_no_truncate','payment_allocations_no_truncate') order by tgname`)).rows;
    expect(t).toHaveLength(9);
    expect(t.every((x) => x.tgenabled === "A")).toBe(true);
  });
});
