// T-083 drift check: the instalment schedule migration (0099) adds instalment_schedules and instalment_rows, three triggers on packages,
// receivables and payment_allocations, the instalment_due alert type, and re-creates no function (every pre-existing function is
// byte-identical; the pattern of tests/db/safety-drift.test.ts). A database is migrated to exactly 0098, then to exactly 0099 and compared.
import { rmSync } from "node:fs";
import { createHash } from "node:crypto";
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
  const toBefore = migrationsUpTo("0098_package_sharing");
  const toAfter = migrationsUpTo("0099_instalment_schedules");
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

describe("T-083: the instalment schedule migration re-creates no function", () => {
  it("every pre-existing function is unchanged, attributes kept; nothing dropped", () => {
    for (const [k, b] of before) {
      const a = after.get(k);
      expect(a, `${k} kept`).toBeDefined();
      expect({ k, def: sha(a!.def), volatile: a!.volatile, secdef: a!.secdef, config: a!.config, acl: a!.acl })
        .toEqual({ k, def: sha(b.def), volatile: b.volatile, secdef: b.secdef, config: b.config, acl: b.acl });
    }
  });

  it("the added functions are the schedule ones; only the writers, the reader and the scan are granted", () => {
    const added = [...after.keys()].filter((k) => !before.has(k)).sort();
    const app = ["instalment_reminder_scan(date)", "instalment_schedule_cancel(uuid)", "instalment_schedule_get(uuid,uuid)", "instalment_schedule_set(text,jsonb)"];
    const internal = ["instalment_cancel_for(uuid,uuid,uuid,text)", "instalment_package_closed()", "instalment_package_paid()", "instalment_receivable_closed()",
      "instalment_rows_guard()", "instalment_schedules_guard()", "instalment_target_open(uuid,uuid,uuid)", "instalment_target_paid(uuid,uuid,uuid)",
      "instalment_target_total(uuid,uuid,uuid)"];
    expect(added).toEqual([...app, ...internal].sort());
    for (const k of added) {
      const acl = after.get(k)!.acl ?? "";
      expect(after.get(k)!.acl, k).not.toBeNull();
      if (app.includes(k)) expect(acl, k).toMatch(/clinic_app=X\//);
      else expect(acl, k).not.toMatch(/clinic_(app|vendor|executor|operator)=X\//);
      expect(acl, k).not.toMatch(/[{,]=X\//);
    }
  });

  it("no existing policy or check changed", () => {
    for (const [k, v] of policiesBefore) expect(policiesAfter.get(k), k).toBe(v);
    expect([...checksBefore.keys()].filter((k) => checksAfter.get(k) !== checksBefore.get(k))).toEqual([]);
  });

  it("the tables are RLS-protected and never truncated; the three cancellation triggers and the guards are enabled always; the alert type", async () => {
    const rls = (await h.admin.query(`select relname, relrowsecurity from pg_class where relname in ('instalment_schedules','instalment_rows') order by relname`)).rows;
    expect(rls.map((r) => [r.relname, r.relrowsecurity])).toEqual([["instalment_rows", true], ["instalment_schedules", true]]);
    const t = (await h.admin.query(`select tgname, tgenabled from pg_trigger where tgname in ('packages_instalment_closed','receivables_instalment_closed',
      'payment_allocations_instalment_paid','instalment_schedules_guard','instalment_rows_guard','instalment_schedules_no_truncate','instalment_rows_no_truncate') order by tgname`)).rows;
    expect(t.map((x) => [x.tgname, x.tgenabled])).toEqual([["instalment_rows_guard", "A"], ["instalment_rows_no_truncate", "A"], ["instalment_schedules_guard", "A"],
      ["instalment_schedules_no_truncate", "A"], ["packages_instalment_closed", "A"], ["payment_allocations_instalment_paid", "A"], ["receivables_instalment_closed", "A"]]);
    expect((await h.admin.query(`select recipient_roles::text r, raisable_by_staff s from notification_types where key = 'instalment_due'`)).rows)
      .toEqual([{ r: "{fo_cashier}", s: false }]);
  });
});
