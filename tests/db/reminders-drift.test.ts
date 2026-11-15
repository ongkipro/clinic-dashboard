// T-095 drift check: migration 0110 adds appointment_reminders with its helpers, guard, scan and reply handler. It re-creates exactly two
// functions — T-094's outbound_params (a care reminder names the clinic, branch, date and time, plan r1 P1-3) and T-093's followup_list (the
// reschedule_request rule, P2-2) — pinned by hash from their reviewed definitions, attributes kept; changes no existing policy or trigger; and
// changes exactly two checks: appointments_state_check (a patient's reply confirms without a staff actor, P1-2) and followups_check (the new
// rule). A database is migrated to exactly 0109, then to exactly 0110.
import { createHash } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
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
  const toBefore = migrationsUpTo("0109_outbound");
  const toAfter = migrationsUpTo("0110_reminders");
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

const sha = (s: string) => createHash("sha256").update(s.trimEnd()).digest("hex");
const CHANGED = ["followup_list(text,text,text)", "outbound_params(outbound_messages)"];
const GRANTED = ["appointment_reminders_readable(uuid,uuid)", "reminder_reply_handle(jsonb)", "reminder_scan(timestamp with time zone)"];
const DEFINERS = ["reminder_reply_handle(jsonb)", "reminder_scan(timestamp with time zone)"];

describe("T-095: the reminders migration re-creates exactly outbound_params and followup_list", () => {
  it("no function dropped; the changed ones are exactly the two, from their reviewed definitions, attributes kept", () => {
    const expected = JSON.parse(readFileSync(join(import.meta.dirname, "reminders-drift.expected.json"), "utf8")) as { before: Record<string, string>; after: Record<string, string> };
    const changed: string[] = [];
    for (const [k, a] of after) {
      const b = before.get(k);
      if (!b) continue;
      if (b.def !== a.def) changed.push(k);
      expect({ k, volatile: a.volatile, secdef: a.secdef, config: a.config, acl: a.acl }).toEqual({ k, volatile: b.volatile, secdef: b.secdef, config: b.config, acl: b.acl });
    }
    expect(changed.sort()).toEqual(CHANGED);
    for (const k of CHANGED) {
      expect(sha(before.get(k)!.def), k).toBe(expected.before[k]);
      expect(sha(after.get(k)!.def), k).toBe(expected.after[k]);
    }
    // the reminder params: clinic (SET-1 else the legal name), branch, an Indonesian date and the time; never a catalog name
    const p = after.get("outbound_params(outbound_messages)")!.def;
    expect(p).toContain("followup_setting(o.tenant_id, 'SET-1'");
    expect(p).toContain("'Minggu','Senin'");
    expect(p).not.toMatch(/catalog_(items|versions)/);
    expect(after.get("followup_list(text,text,text)")!.def).toContain("'dormant','reschedule_request'");
    expect([...before.keys()].filter((x) => !after.has(x))).toEqual([]);
  });

  it("the granted functions are the scan, the reply handler and the RLS predicate; definers pin the path; the helpers are not granted", () => {
    const added = [...after.keys()].filter((k) => !before.has(k)).sort();
    const granted = added.filter((k) => /clinic_app=X\//.test(after.get(k)!.acl ?? "")).sort();
    expect(granted).toEqual(GRANTED);
    for (const k of added) expect(after.get(k)!.acl ?? "", k).not.toMatch(/clinic_(vendor|executor|operator)=X\//);
    for (const k of DEFINERS) {
      expect(after.get(k)!.secdef, k).toBe(true);
      expect(after.get(k)!.config, k).toBe("search_path=pg_catalog, pg_temp");
    }
    expect(added.filter((k) => after.get(k)!.secdef).sort()).toEqual(DEFINERS);
  });

  it("no existing policy or trigger changed; the two changed checks gain exactly the planned clauses", () => {
    for (const [k, v] of policiesBefore) expect(policiesAfter.get(k), k).toBe(v);
    for (const [k, v] of triggersBefore) expect(triggersAfter.get(k), k).toBe(v);
    expect([...triggersAfter.keys()].filter((k) => !triggersBefore.has(k) && !/^appointment_reminders\./.test(k))).toEqual([]);
    const changed = [...checksBefore.keys()].filter((k) => checksAfter.get(k) !== checksBefore.get(k)).sort();
    expect(changed).toEqual(["appointments.appointments_state_check", "followups.followups_check"]);
    const ap = checksAfter.get("appointments.appointments_state_check")!;
    expect(checksBefore.get("appointments.appointments_state_check")).toContain("(state_changed_by IS NOT NULL)");
    // a staff actor is still required for every state but confirmed; never set on held / booked
    expect(ap).toContain("(state_changed_at IS NOT NULL)");
    expect(ap).toMatch(/OR \(state_changed_by IS NULL\)/);
    expect(ap).toMatch(/OR \(state_changed_by IS NOT NULL\)/);
    const fb = checksBefore.get("followups.followups_check")!;
    const fa = checksAfter.get("followups.followups_check")!;
    // Postgres prints the IN list as nested ORs: every old (rule, source, queue) shape kept, the one new shape added, the rest unchanged
    const shapes = (c: string) => [...c.matchAll(/\(rule_code = '([a-z_]+)'::text\) AND \(source_kind = '([a-z_]+)'::text\) AND \(role_queue = '([a-z]+)'::text\)/g)].map((m) => m.slice(1).join("/"));
    expect(shapes(fa)).toEqual([...shapes(fb), "reschedule_request/appointment/cs"]);
    const tail = (c: string) => c.slice(c.indexOf("step ~"));
    expect(tail(fa)).toBe(tail(fb));
    expect([...checksAfter.keys()].filter((k) => !checksBefore.has(k) && !/^appointment_reminders\./.test(k))).toEqual([]);
  });
});
