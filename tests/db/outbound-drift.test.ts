// T-094 drift check: migration 0109 adds outbound_messages with its own helpers, guard, writers, dispatch and reader. It re-creates no
// existing function, changes no existing policy or trigger, and changes exactly one existing check: messages_check, which now lets a template
// sent by the outbound dispatcher have no staff author (plan r1 P1-2) — every other clause kept. A database is migrated to exactly 0108,
// then to exactly 0109.
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
  const toBefore = migrationsUpTo("0108_followups");
  const toAfter = migrationsUpTo("0109_outbound");
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

const GRANTED = ["outbound_backlog(uuid)", "outbound_bill(text,uuid)", "outbound_claim(timestamp with time zone)",
  "outbound_complete(uuid,text,text,timestamp with time zone)", "outbound_enqueue(text,jsonb)", "outbound_readable(uuid,uuid)"];
const DEFINERS = ["outbound_backlog(uuid)", "outbound_bill(text,uuid)", "outbound_claim(timestamp with time zone)",
  "outbound_complete(uuid,text,text,timestamp with time zone)", "outbound_enqueue(text,jsonb)"];

describe("T-094: the outbound migration only adds (and widens messages_check)", () => {
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
    expect(after.get("outbound_enqueue_do(uuid,text,text,uuid,uuid,uuid,text,uuid,date,uuid,text,timestamp with time zone)")!.acl ?? "").not.toMatch(/clinic_app=X\//);
  });

  it("no existing policy or trigger changed; the only existing check changed is messages_check, which gains exactly the template exemption", () => {
    for (const [k, v] of policiesBefore) expect(policiesAfter.get(k), k).toBe(v);
    for (const [k, v] of triggersBefore) expect(triggersAfter.get(k), k).toBe(v);
    expect([...triggersAfter.keys()].filter((k) => !triggersBefore.has(k) && !/^outbound_messages\./.test(k))).toEqual([]);
    const changed = [...checksBefore.keys()].filter((k) => checksAfter.get(k) !== checksBefore.get(k));
    expect(changed).toEqual(["messages.messages_check"]);
    const was = checksBefore.get("messages.messages_check")!;
    const now = checksAfter.get("messages.messages_check")!;
    expect(was).toContain("(sent_via = 'business_app'::text) OR (author_staff_id IS NOT NULL)");
    expect(now).toContain("(sent_via = 'business_app'::text) OR (kind = 'template'::text) OR (author_staff_id IS NOT NULL)");
    expect(now.replace(" OR (kind = 'template'::text)", "")).toBe(was);
    expect([...checksAfter.keys()].filter((k) => !checksBefore.has(k) && !/^outbound_messages\./.test(k))).toEqual([]);
  });
;
});
