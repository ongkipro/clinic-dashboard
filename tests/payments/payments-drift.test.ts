// T-073 drift check: the payment port migration (0088) adds its tables, triggers and functions and re-creates exactly
// the declared 0087 Kasir functions — payment_receive (now through the shared kasir_record_payment), payments_guard (a
// port payment names its charge), kasir_receipt_body (QRIS, VA, Link Bayar labels), invoice_void_sync (cancels a
// pending charge), kasir_invoice_get (the port's tenders and charges) and receipt_get (simulated) — each with its
// signature and attributes. A database is migrated to exactly 0087, then to exactly 0088 and compared: every other
// function stays byte-identical (sha-256 of both versions of the changed ones in payments-drift.expected.json); the
// added functions are the declared ones, granted to clinic_app only where the app calls them; no existing policy
// changed or dropped; no existing constraint changed.
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
  const toBefore = migrationsUpTo("0087_kasir");
  const toAfter = migrationsUpTo("0088_payment_port");
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
  "invoice_void_sync()", "kasir_invoice_get(uuid)", "kasir_receipt_body(invoices,text,timestamp with time zone,jsonb)", "payment_receive(text,uuid,jsonb)",
  "payments_guard()", "receipt_get(uuid)",
];

describe("T-073: the payment port migration re-creates only the declared Kasir functions", () => {
  it("no function dropped; the changed ones are exactly the declared set, from their reviewed 0087 to their reviewed 0088 definitions, attributes kept", () => {
    const changed: string[] = [];
    for (const [k, a] of after) {
      const b = before.get(k);
      if (!b) continue;
      if (b.def !== a.def) changed.push(k);
      expect({ k, volatile: a.volatile, secdef: a.secdef, config: a.config, acl: a.acl }).toEqual({ k, volatile: b.volatile, secdef: b.secdef, config: b.config, acl: b.acl });
    }
    expect(changed.sort()).toEqual(CHANGED);
    const file = join(import.meta.dirname, "payments-drift.expected.json");
    if (process.env.T073_WRITE_EXPECTED) {
      writeFileSync(file, JSON.stringify({ before: Object.fromEntries(CHANGED.map((k) => [k, sha(before.get(k)!.def)])),
        after: Object.fromEntries(CHANGED.map((k) => [k, sha(after.get(k)!.def)])) }, null, 2) + "\n");
    }
    const expected = JSON.parse(readFileSync(file, "utf8")) as { before: Record<string, string>; after: Record<string, string> };
    for (const k of CHANGED) {
      expect(sha(before.get(k)!.def), `${k} before`).toBe(expected.before[k]);
      expect(sha(after.get(k)!.def), `${k} after`).toBe(expected.after[k]);
    }
    expect(after.get("payment_receive(text,uuid,jsonb)")!.def).toContain("kasir_record_payment");
    expect([...before.keys()].filter((x) => !after.has(x))).toEqual([]);
  });

  it("the added functions are the port ones; only the writers, readers, the webhook entry points and read predicates are granted to clinic_app", () => {
    const added = [...after.keys()].filter((k) => !before.has(k)).sort();
    const app = [
      "payment_port_enable(integer)", "payment_charge_create(text,uuid,jsonb)", "payment_charge_poll(uuid,jsonb)", "payment_charge_cancel(uuid)",
      "payment_refund(text,uuid,bigint)", "payment_webhook_route(text)", "payment_webhook_ingest(jsonb,boolean,boolean,text)", "payment_mock_status(uuid)",
      "simulasi_set(uuid,text)", "simulasi_list(uuid)", "payment_readable(uuid,uuid)", "payment_config_readable(uuid)",
    ];
    const internal = [
      "payment_deploy_env()", "payment_port_of(uuid)", "payment_port_usable(payment_port_configs)", "payment_audit_service(uuid,text,text,uuid,text,text)",
      "payment_line_room(uuid,uuid,boolean)", "payment_description(uuid,uuid)", "payment_mock_payload(payment_charges,payment_mock_states)",
      "payment_port_configs_guard()", "payment_charges_guard()", "payment_refunds_guard()", "payment_mock_states_guard()", "payment_webhook_events_guard()",
      "kasir_record_payment(invoices,text,jsonb,jsonb,uuid,text,timestamp with time zone)",
      "kasir_record_payment_unallocated(payment_charges,invoices,uuid,uuid,text,timestamp with time zone)",
      "payment_charge_settle(payment_charges,invoices,text,bigint,uuid,uuid,text)", "payment_charge_locked(uuid,uuid)",
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

  it("no existing policy or constraint changed or dropped", () => {
    for (const [k, v] of policiesBefore) expect(policiesAfter.get(k), k).toBe(v);
    for (const [k, v] of checksBefore) expect(checksAfter.get(k), k).toBe(v);
  });

  it("the new triggers are enabled always", async () => {
    const t = (await h.admin.query(`select tgname, tgenabled from pg_trigger where tgname in ('payment_port_configs_guard','payment_charges_guard','payment_refunds_guard',
      'payment_mock_states_guard','payment_webhook_events_guard','payment_charge_lines_insert_only','payment_refunds_insert_only') order by tgname`)).rows;
    expect(t).toHaveLength(7);
    expect(t.every((x) => x.tgenabled === "A")).toBe(true);
  });
});
