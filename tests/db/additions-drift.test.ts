// T-074 drift check: the additions migration (0089) adds its table, trigger and functions and re-creates exactly the
// declared functions — treatment_item_blockers and treatment_start (the per-item payment rule), kasir_visit_payment
// (a performed addition not billed owes), visit_close (unbilled_addition first), invoice_lines_guard (the plan item
// frozen, visit invoices only), invoice_issue (the addition invoice) and kasir_invoice_get (the line's plan item) — each
// with its signature and attributes; invoice_line_snapshot is replaced by a 6-argument version (the 5-argument one
// dropped; invoice_issue is its only caller). A database is migrated to exactly 0088, then to exactly 0089 and
// compared: every other function stays byte-identical (sha-256 of both versions of the changed ones in
// additions-drift.expected.json); the added functions are the declared ones, granted to clinic_app only where the app
// calls them; no existing policy changed or dropped; no existing constraint changed.
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
  const toBefore = migrationsUpTo("0088_payment_port");
  const toAfter = migrationsUpTo("0089_additions");
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
  "invoice_issue(text,uuid,jsonb)", "invoice_lines_guard()", "kasir_invoice_get(uuid)", "kasir_visit_payment(uuid,uuid)", "treatment_item_blockers(visits,uuid)",
  "treatment_start(text,uuid,jsonb)", "visit_close(uuid)",
];
const DROPPED = ["invoice_line_snapshot(invoices,uuid,integer,bigint,timestamp with time zone)"];

describe("T-074: the additions migration re-creates only the declared functions", () => {
  it("no function dropped; the changed ones are exactly the declared set, from their reviewed 0087 to their reviewed 0088 definitions, attributes kept", () => {
    const changed: string[] = [];
    for (const [k, a] of after) {
      const b = before.get(k);
      if (!b) continue;
      if (b.def !== a.def) changed.push(k);
      expect({ k, volatile: a.volatile, secdef: a.secdef, config: a.config, acl: a.acl }).toEqual({ k, volatile: b.volatile, secdef: b.secdef, config: b.config, acl: b.acl });
    }
    expect(changed.sort()).toEqual(CHANGED);
    const file = join(import.meta.dirname, "additions-drift.expected.json");
    if (process.env.T074_WRITE_EXPECTED) {
      writeFileSync(file, JSON.stringify({ before: Object.fromEntries(CHANGED.map((k) => [k, sha(before.get(k)!.def)])),
        after: Object.fromEntries(CHANGED.map((k) => [k, sha(after.get(k)!.def)])) }, null, 2) + "\n");
    }
    const expected = JSON.parse(readFileSync(file, "utf8")) as { before: Record<string, string>; after: Record<string, string> };
    for (const k of CHANGED) {
      expect(sha(before.get(k)!.def), `${k} before`).toBe(expected.before[k]);
      expect(sha(after.get(k)!.def), `${k} after`).toBe(expected.after[k]);
    }
    expect(after.get("treatment_start(text,uuid,jsonb)")!.def).toContain("treatment_payment_unpaid(v, v_item)");
    expect(after.get("visit_close(uuid)")!.def.indexOf("unbilled_addition")).toBeLessThan(after.get("visit_close(uuid)")!.def.indexOf("unpaid_bill"));
    expect([...before.keys()].filter((x) => !after.has(x))).toEqual(DROPPED);
  });

  it("the added functions are the additions ones; only the release writer and the reader are granted to clinic_app", () => {
    const added = [...after.keys()].filter((k) => !before.has(k)).sort();
    const app = ["addition_release(text,uuid,jsonb)", "addition_visit_list(uuid)"];
    const internal = [
      "addition_of_visit(uuid,uuid,uuid)", "addition_line(uuid,uuid,uuid)", "addition_paid(uuid,uuid,uuid)", "addition_unbilled_counted(uuid,uuid)",
      "treatment_payment_unpaid(visits,uuid)", "addition_finished()", "invoice_line_snapshot(invoices,uuid,integer,bigint,timestamp with time zone,uuid)",
    ];
    expect(added).toEqual([...app, ...internal].sort());
    for (const k of added) {
      const acl = after.get(k)!.acl ?? "";
      expect(after.get(k)!.acl, k).not.toBeNull();
      if (app.includes(k)) expect(acl, k).toMatch(/clinic_app=X\//);
      else expect(acl, k).not.toMatch(/clinic_(app|vendor|executor|operator)=X\//);
      expect(acl, k).not.toMatch(/[{,]=X\//);
    }
    // The replaced snapshot keeps the dropped one's attributes.
    const was = before.get(DROPPED[0])!; const now = after.get("invoice_line_snapshot(invoices,uuid,integer,bigint,timestamp with time zone,uuid)")!;
    expect([now.volatile, now.secdef, now.config]).toEqual([was.volatile, was.secdef, was.config]);
  });

  it("no existing policy or constraint changed or dropped", () => {
    for (const [k, v] of policiesBefore) expect(policiesAfter.get(k), k).toBe(v);
    for (const [k, v] of checksBefore) expect(checksAfter.get(k), k).toBe(v);
  });

  it("the new triggers are enabled always", async () => {
    const t = (await h.admin.query(`select tgname, tgenabled from pg_trigger where tgname in ('addition_releases_insert_only','treatment_executions_addition_finished',
      'addition_releases_no_truncate') order by tgname`)).rows;
    expect(t).toHaveLength(3);
    expect(t.every((x) => x.tgenabled === "A")).toBe(true);
  });
});
