// T-077 drift check: the deposits migration (0093) adds booking_deposits and its writers and re-creates exactly the
// declared functions, each with its signature and attributes: kasir_line_paid and payment_line_room (an applied deposit is
// paid), payment_allocations_guard (the deposit target), payments_guard (a payment with no invoice is a top-up or a deposit),
// receipt_get (the deposit receipt masked), invoice_void_request and invoice_void_sync (an applied deposit makes the invoice
// paid), appointment_cancel, appointment_no_show and appointment_reschedule (the patient change decides the held DP) and
// invoice_issue (the DP applied on arrival). A database is migrated to exactly 0092, then to exactly 0093 and compared: every
// other function stays byte-identical (sha-256 of both versions of the changed ones in deposits-drift.expected.json).
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
  const toBefore = migrationsUpTo("0092_one_clock");
  const toAfter = migrationsUpTo("0093_deposits");
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
  "appointment_cancel(uuid,text)", "appointment_no_show(uuid)", "appointment_reschedule(uuid,timestamp with time zone,uuid)", "invoice_issue(text,uuid,jsonb)",
  "invoice_void_request(uuid,text)", "invoice_void_sync()", "kasir_line_paid(uuid,uuid)", "payment_allocations_guard()", "payment_line_room(uuid,uuid,boolean)",
  "payments_guard()", "receipt_get(uuid)",
].sort();

describe("T-077: the deposits migration re-creates only the declared functions", () => {
  it("no function dropped; the changed ones are exactly the declared set, attributes kept", () => {
    const changed: string[] = [];
    for (const [k, a] of after) {
      const b = before.get(k);
      if (!b) continue;
      if (b.def !== a.def) changed.push(k);
      expect({ k, volatile: a.volatile, secdef: a.secdef, config: a.config, acl: a.acl }).toEqual({ k, volatile: b.volatile, secdef: b.secdef, config: b.config, acl: b.acl });
    }
    expect(changed.sort()).toEqual(CHANGED);
    const file = join(import.meta.dirname, "deposits-drift.expected.json");
    if (process.env.T077_WRITE_EXPECTED) {
      writeFileSync(file, JSON.stringify({ before: Object.fromEntries(CHANGED.map((k) => [k, sha(before.get(k)!.def)])),
        after: Object.fromEntries(CHANGED.map((k) => [k, sha(after.get(k)!.def)])) }, null, 2) + "\n");
    }
    const expected = JSON.parse(readFileSync(file, "utf8")) as { before: Record<string, string>; after: Record<string, string> };
    for (const k of CHANGED) {
      expect(sha(before.get(k)!.def), `${k} before`).toBe(expected.before[k]);
      expect(sha(after.get(k)!.def), `${k} after`).toBe(expected.after[k]);
    }
    expect(after.get("invoice_issue(text,uuid,jsonb)")!.def).toContain("deposit_apply_do(i, dep, a.staff_id, a.role)");
    expect([...before.keys()].filter((x) => !after.has(x))).toEqual([]);
  });

  it("the added functions are the deposit ones; only the writers and the read predicate are granted to clinic_app", () => {
    const added = [...after.keys()].filter((k) => !before.has(k)).sort();
    const app = ["deposit_receive(text,uuid,jsonb)", "deposit_apply(uuid)", "appointment_cancel_clinic(uuid,text)", "deposit_refund_clinic(text,uuid,jsonb)", "deposit_readable(uuid,uuid)"];
    const internal = [
      "deposit_setting(uuid,timestamp with time zone)", "deposit_decide(booking_deposits,text,text,uuid,text,text,jsonb)", "deposit_on_patient_change(appointments,text,boolean)",
      "deposit_apply_do(invoices,booking_deposits,uuid,text)", "booking_deposits_guard()",
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

  it("no existing policy or constraint changed or dropped; the allocation check adds the deposit target", () => {
    for (const [k, v] of policiesBefore) expect(policiesAfter.get(k), k).toBe(v);
    for (const [k, v] of checksBefore) if (k !== "payment_allocations.payment_allocations_check") expect(checksAfter.get(k), k).toBe(v);
    expect(checksAfter.get("payment_allocations.payment_allocations_check")).toContain("num_nonnulls(invoice_line_id, top_up_id, booking_deposit_id) = 1");
  });

  it("the new triggers are enabled always", async () => {
    const t = (await h.admin.query(`select tgname, tgenabled from pg_trigger where tgname in ('booking_deposits_guard','booking_deposits_no_truncate') order by tgname`)).rows;
    expect(t.map((x) => [x.tgname, x.tgenabled])).toEqual([["booking_deposits_guard", "A"], ["booking_deposits_no_truncate", "A"]]);
  });
});
