// T-078 drift check: the receivables migration (0094) adds refunds, receivables, receivable_lines, receivable_collections and
// write_offs with their writers and readers, and re-creates exactly the declared functions, each with its signature and
// attributes: the converted remainder settled (kasir_outstanding, payment_line_room, kasir_record_payment, payment_charge_create,
// deposit_apply_do, invoice_lines_guard), the receivable target (payment_allocations_guard, payments_guard: exactly one kind),
// the collection receipt masked (receipt_get), a void refused after conversion (invoice_void_request/_sync), the shared ceiling
// with a pending cash refund (interrupted_to_balance, package_close_do), the handover blocked while a refund is pending
// (dispensing_blocker), and a merge refused with an open receivable (patient_merges_balance_guard). A database is migrated to
// exactly 0093, then to exactly 0094 and compared (sha-256 of both versions of the changed ones in receivables-drift.expected.json).
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
  const toBefore = migrationsUpTo("0093_deposits");
  const toAfter = migrationsUpTo("0094_receivables");
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
  "deposit_apply_do(invoices,booking_deposits,uuid,text)", "dispensing_blocker(dispensings)", "interrupted_to_balance(text,uuid)", "invoice_lines_guard()",
  "invoice_void_request(uuid,text)", "invoice_void_sync()", "kasir_outstanding(uuid,uuid)",
  "kasir_record_payment(invoices,text,jsonb,jsonb,uuid,text,timestamp with time zone)", "package_close_do(packages,text,text,uuid,text,timestamp with time zone)",
  "patient_merges_balance_guard()", "payment_allocations_guard()", "payment_charge_create(text,uuid,jsonb)", "payment_line_room(uuid,uuid,boolean)", "payments_guard()",
  "receipt_get(uuid)",
].sort();

describe("T-078: the receivables migration re-creates only the declared functions", () => {
  it("no function dropped; the changed ones are exactly the declared set, attributes kept", () => {
    const changed: string[] = [];
    for (const [k, a] of after) {
      const b = before.get(k);
      if (!b) continue;
      if (b.def !== a.def) changed.push(k);
      expect({ k, volatile: a.volatile, secdef: a.secdef, config: a.config, acl: a.acl }).toEqual({ k, volatile: b.volatile, secdef: b.secdef, config: b.config, acl: b.acl });
    }
    expect(changed.sort()).toEqual(CHANGED);
    const file = join(import.meta.dirname, "receivables-drift.expected.json");
    if (process.env.T078_WRITE_EXPECTED) {
      writeFileSync(file, JSON.stringify({ before: Object.fromEntries(CHANGED.map((k) => [k, sha(before.get(k)!.def)])),
        after: Object.fromEntries(CHANGED.map((k) => [k, sha(after.get(k)!.def)])) }, null, 2) + "\n");
    }
    const expected = JSON.parse(readFileSync(file, "utf8")) as { before: Record<string, string>; after: Record<string, string> };
    for (const k of CHANGED) {
      expect(sha(before.get(k)!.def), `${k} before`).toBe(expected.before[k]);
      expect(sha(after.get(k)!.def), `${k} after`).toBe(expected.after[k]);
    }
    expect([...before.keys()].filter((x) => !after.has(x))).toEqual([]);
  });

  it("the added functions are the receivable ones; only the writers, readers and predicates are granted to clinic_app", () => {
    const added = [...after.keys()].filter((k) => !before.has(k)).sort();
    const app = [
      "refund_request(text,uuid,jsonb)", "refund_pay(text,uuid,jsonb)", "receivable_convert(text,uuid)", "receivable_collect(text,uuid,jsonb)",
      "receivable_write_off_request(uuid,text)", "receivable_write_off_owner(text,uuid,text)", "piutang_get(uuid)", "refund_line_options(uuid)",
      "approval_manager_decides_refund(uuid)", "receivable_readable(uuid,uuid)", "refund_invoice_picks()",
    ];
    const internal = [
      "refund_manager_may_decide(timestamp with time zone)", "refund_reserved(uuid,uuid)", "refund_line_delivered(invoice_lines,invoices)",
      "refund_settle(refunds,uuid,text,text)", "refund_exception_sync()", "write_off_do(receivables,uuid,text,boolean,uuid,uuid,uuid,text)", "write_off_sync()",
      "refunds_guard()", "receivables_guard()",
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

  it("no existing policy changed or dropped; the changed constraints are the declared ones", () => {
    for (const [k, v] of policiesBefore) expect(policiesAfter.get(k), k).toBe(v);
    const changedChecks = [...checksBefore.keys()].filter((k) => checksAfter.get(k) !== checksBefore.get(k)).sort();
    expect(changedChecks).toEqual(["invoice_lines.invoice_lines_t076_check", "payment_allocations.payment_allocations_check", "stock_movements.stock_movements_check"]);
    expect(checksAfter.get("payment_allocations.payment_allocations_check")).toContain("num_nonnulls(invoice_line_id, top_up_id, booking_deposit_id, receivable_id) = 1");
    expect(checksAfter.get("stock_movements.stock_movements_check")).toContain("source_kind = 'refund'");
  });

  it("the new triggers are enabled always", async () => {
    const names = ["refunds_guard", "receivables_guard", "receivable_lines_insert_only", "receivable_collections_insert_only", "write_offs_insert_only",
      "approvals_refund_exception_sync", "approvals_write_off_sync"];
    const t = (await h.admin.query(`select tgname, tgenabled from pg_trigger where tgname = any($1)`, [names])).rows;
    expect(t.map((x) => x.tgname).sort()).toEqual([...names].sort());
    expect(t.every((x) => x.tgenabled === "A")).toBe(true);
  });
});
