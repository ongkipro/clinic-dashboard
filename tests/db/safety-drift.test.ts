// T-068 drift check: the safety migration (0085) adds its tables, triggers, functions and alert types and re-creates
// nothing. A database is migrated to exactly 0084, every public function, policy and constraint captured, then to
// exactly 0085 and compared: every existing function is byte-identical with its attributes; the added functions
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
  const toBefore = migrationsUpTo("0084_payables");
  const toAfter = migrationsUpTo("0085_safety");
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

describe("T-068: the safety migration re-creates nothing", () => {
  it("every existing function is byte-identical with its attributes; none dropped", () => {
    for (const [k, b] of before) {
      const a = after.get(k);
      expect(a, k).toBeDefined();
      expect({ k, ...a }).toEqual({ k, ...b });
    }
  });

  it("the added functions are the safety ones; only the writers, readers and the scan are granted to clinic_app", () => {
    const added = [...after.keys()].filter((k) => !before.has(k)).sort();
    const app = ["logbook_readable(uuid,uuid)", "incident_readable(uuid,uuid,uuid)", "device_schedule_set(uuid,jsonb)", "logbook_record(text,uuid,jsonb)", "logbook_due_scan(date)",
      "incident_report(text,uuid,jsonb)", "incident_handle(uuid,text,jsonb)", "logbook_overview(uuid,text)", "incident_list(uuid)", "incident_get(uuid)", "incident_patient_options(uuid)"];
    const internal = ["safety_actor(text[],uuid)", "safety_text(jsonb,text,integer,integer,boolean)", "safety_date(jsonb,text)", "safety_today(uuid,uuid)", "safety_insert_only()",
      "device_schedules_guard()", "clinical_incidents_guard()", "safety_reader(text[])", "incident_json(clinical_incidents,boolean,boolean)"];
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

  it("the new triggers are enabled always; the alert types exist", async () => {
    const t = (await h.admin.query(`select tgname, tgenabled from pg_trigger where tgname in ('logbook_entries_guard','logbook_due_alerts_guard','clinical_incident_events_guard',
      'device_schedules_guard','clinical_incidents_guard') order by tgname`)).rows;
    expect(t).toHaveLength(5);
    expect(t.every((x) => x.tgenabled === "A")).toBe(true);
    expect((await h.admin.query(`select key from notification_types where key in ('logbook_calibration_due','logbook_maintenance_due','incident_reported') order by key`)).rows.map((r) => r.key))
      .toEqual(["incident_reported", "logbook_calibration_due", "logbook_maintenance_due"]);
  });
});
