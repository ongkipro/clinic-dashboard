// T-091 drift check: migration 0106 adds complaint_tasks.message_id (FK, coupling check, open-task index), the internal complaint_flag_do
// and the granted complaint_flag_from_message, and re-creates exactly complaint_flag, complaint_guard and complaint_json (plan r1 P1-3: the
// shared rules moved to complaint_flag_do; message_id frozen and projected) — their 0074 and 0106 definitions pinned by SHA-256. A database
// is migrated to exactly 0105, then to exactly 0106.
import { readFileSync, rmSync } from "node:fs";
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
  const toBefore = migrationsUpTo("0105_inbox");
  const toAfter = migrationsUpTo("0106_complaint_message_flag");
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

const CHANGED = ["complaint_flag(uuid,jsonb)", "complaint_guard()", "complaint_json(complaint_tasks,boolean)"];

describe("T-091: the inbox flag migration re-creates only the three complaint functions", () => {
  it("no function dropped; the changed ones are exactly the three, from their reviewed 0074 to their reviewed 0106 definitions, attributes kept", () => {
    const expected = JSON.parse(readFileSync(join(import.meta.dirname, "flag-drift.expected.json"), "utf8")) as { before: Record<string, string>; after: Record<string, string> };
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
    expect(after.get("complaint_flag(uuid,jsonb)")!.def).toContain("message_source_not_ready");
    expect(after.get("complaint_flag(uuid,jsonb)")!.def).toContain("complaint_flag_do");
    expect(after.get("complaint_guard()")!.def).toContain("'message_id'");
    expect(after.get("complaint_json(complaint_tasks,boolean)")!.def).toContain("'message_id', t.message_id");
    expect([...before.keys()].filter((x) => !after.has(x))).toEqual([]);
  });

  it("the added functions are the internal complaint_flag_do and the granted complaint_flag_from_message; definers pin the path", () => {
    const added = [...after.keys()].filter((k) => !before.has(k)).sort();
    expect(added).toEqual(["complaint_flag_do(record,uuid,uuid,uuid,uuid,text,jsonb)", "complaint_flag_from_message(uuid,jsonb)"]);
    expect(after.get("complaint_flag_from_message(uuid,jsonb)")!.acl ?? "").toMatch(/clinic_app=X\//);
    expect(after.get("complaint_flag_from_message(uuid,jsonb)")!.secdef).toBe(true);
    expect(after.get("complaint_flag_from_message(uuid,jsonb)")!.config).toBe("search_path=pg_catalog, pg_temp");
    expect(after.get("complaint_flag_do(record,uuid,uuid,uuid,uuid,text,jsonb)")!.acl ?? "").not.toMatch(/clinic_(app|vendor|executor|operator)=X\//);
    expect(after.get("complaint_flag_do(record,uuid,uuid,uuid,uuid,text,jsonb)")!.secdef).toBe(false);
  });

  it("no existing policy changed; the only check added is complaint_tasks_message_check; the support class stays clinical", async () => {
    for (const [k, v] of policiesBefore) expect(policiesAfter.get(k), k).toBe(v);
    expect([...checksBefore.keys()].filter((k) => checksAfter.get(k) !== checksBefore.get(k))).toEqual([]);
    expect([...checksAfter.keys()].filter((k) => !checksBefore.has(k)).sort()).toEqual(["complaint_tasks.complaint_tasks_message_check", "complaint_tasks.complaint_tasks_message_fk"]);
    expect((await h.admin.query(`select support_class from support_object_kinds where table_name = 'public.complaint_tasks'`)).rows[0].support_class).toBe("clinical");
    expect((await h.admin.query(`select writer_service from scope_map where table_name = 'public.complaint_tasks'`)).rows[0].writer_service).toContain("complaint_flag_from_message");
  });
});
