// T-093 drift check: migration 0108 adds followups with its own helpers, guard, scan, writer and readers, and one trigger on an existing
// table (appointments_followup_no_show, AFTER UPDATE OF state, SECURITY INVOKER — appointment_no_show is not re-created). It re-creates no
// existing function, changes no existing policy, check or trigger, and appointments gain exactly that trigger. A database is migrated to
// exactly 0107, then to exactly 0108.
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
let triggersBefore: Map<string, string>;
let triggersAfter: Map<string, string>;
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
async function triggers(db: pg.ClientBase): Promise<Map<string, string>> {
  const r = await db.query<{ k: string; v: string }>(
    `select c.relname || '.' || t.tgname as k, pg_get_triggerdef(t.oid) || ' ' || t.tgenabled::text as v from pg_trigger t join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not t.tgisinternal`,
  );
  return new Map(r.rows.map((x) => [x.k, x.v]));
}

beforeAll(async () => {
  const toBefore = migrationsUpTo("0107_leads");
  const toAfter = migrationsUpTo("0108_followups");
  dirs = [toBefore, toAfter];
  let url = "";
  h = await createHarness({ migrate: async (u) => { url = u; await runMigrations(u, { folder: toBefore }); } });
  before = await capture(h.admin);
  policiesBefore = await policies(h.admin);
  checksBefore = await checks(h.admin);
  triggersBefore = await triggers(h.admin);
  await runMigrations(url, { folder: toAfter });
  after = await capture(h.admin);
  policiesAfter = await policies(h.admin);
  checksAfter = await checks(h.admin);
  triggersAfter = await triggers(h.admin);
}, 300_000);

afterAll(async () => {
  await h?.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const GRANTED = ["followup_get(uuid)", "followup_list(text,text,text)", "followup_scan(date)", "followup_update(uuid,jsonb)",
  "followups_readable(uuid,uuid,text,text,uuid)"];
const DEFINERS = ["followup_get(uuid)", "followup_list(text,text,text)", "followup_scan(date)", "followup_update(uuid,jsonb)"];

describe("T-093: the follow-ups migration only adds", () => {
  it("no existing function re-created, dropped or re-attributed", () => {
    const changed: string[] = [];
    for (const [k, a] of after) {
      const b = before.get(k);
      if (!b) continue;
      if (b.def !== a.def) changed.push(k);
      expect({ k, volatile: a.volatile, secdef: a.secdef, config: a.config, acl: a.acl }).toEqual({ k, volatile: b.volatile, secdef: b.secdef, config: b.config, acl: b.acl });
    }
    expect(changed).toEqual([]);
    expect([...before.keys()].filter((x) => !after.has(x))).toEqual([]);
  });

  it("the granted functions are exactly the writers, readers and RLS predicates; definers pin the path; the helpers are not granted", () => {
    const added = [...after.keys()].filter((k) => !before.has(k)).sort();
    const granted = added.filter((k) => /clinic_app=X\//.test(after.get(k)!.acl ?? "")).sort();
    expect(granted).toEqual(GRANTED);
    for (const k of added) expect(after.get(k)!.acl ?? "", k).not.toMatch(/clinic_(vendor|executor|operator)=X\//);
    for (const k of DEFINERS) {
      expect(after.get(k)!.secdef, k).toBe(true);
      expect(after.get(k)!.config, k).toBe("search_path=pg_catalog, pg_temp");
    }
    expect(added.filter((k) => after.get(k)!.secdef).sort()).toEqual(DEFINERS);
    expect(after.get("appointments_followup_no_show()")!.secdef).toBe(false);
  });

  it("no existing policy, check or trigger changed; appointments gain only appointments_followup_no_show", () => {
    for (const [k, v] of policiesBefore) expect(policiesAfter.get(k), k).toBe(v);
    expect([...checksBefore.keys()].filter((k) => checksAfter.get(k) !== checksBefore.get(k))).toEqual([]);
    expect([...checksAfter.keys()].filter((k) => !checksBefore.has(k) && !/^followups\./.test(k))).toEqual([]);
    for (const [k, v] of triggersBefore) expect(triggersAfter.get(k), k).toBe(v);
    const addedTriggers = [...triggersAfter.keys()].filter((k) => !triggersBefore.has(k)).sort();
    expect(addedTriggers.filter((k) => !/^followups\./.test(k))).toEqual(["appointments.appointments_followup_no_show"]);
    expect(triggersAfter.get("appointments.appointments_followup_no_show")).toMatch(/AFTER UPDATE OF state ON public\.appointments FOR EACH ROW .* A$/);
  });
});
