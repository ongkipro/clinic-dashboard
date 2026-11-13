// T-076 drift check: the packages migration (0091) adds its tables, triggers and functions and re-creates exactly the
// declared Kasir, port and treatment functions (the package invoice, the cancelled remainder and room, the minimum DP,
// the top-up payment and receipt, the void closing its package, the start rule and the additions with package sessions,
// treatment_finish's clinic-stop blocker), each with its signature and attributes; invoice_line_snapshot is replaced
// by a 7-argument version (the 6-argument one dropped; invoice_issue is its only caller). A database is migrated to
// exactly 0090, then to exactly 0091 and compared: every other function stays byte-identical (sha-256 of both versions
// of the changed ones in packages-drift.expected.json); the added functions are the declared ones, granted to
// clinic_app only where the app calls them; no existing policy changed; no existing constraint changed except the
// allocation target check (a top-up target, DATA-28); the new triggers are enabled always.
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
  const toBefore = migrationsUpTo("0090_balance");
  const toAfter = migrationsUpTo("0091_packages");
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
  "addition_finished()", "addition_unbilled_counted(uuid,uuid)", "invoice_issue(text,uuid,jsonb)", "invoice_lines_guard()", "invoice_void_sync()",
  "kasir_outstanding(uuid,uuid)", "kasir_record_payment(invoices,text,jsonb,jsonb,uuid,text,timestamp with time zone)", "payment_allocations_guard()",
  "payment_charge_create(text,uuid,jsonb)", "payment_line_room(uuid,uuid,boolean)", "payment_receive(text,uuid,jsonb)", "payments_guard()", "receipt_get(uuid)",
  "treatment_finish(text,uuid,jsonb)", "treatment_payment_unpaid(visits,uuid)",
].sort();
const DROPPED = ["invoice_line_snapshot(invoices,uuid,integer,bigint,timestamp with time zone,uuid)"];

describe("T-076: the packages migration re-creates only the declared functions", () => {
  it("no function dropped; the changed ones are exactly the declared set, from their reviewed 0087 to their reviewed 0088 definitions, attributes kept", () => {
    const changed: string[] = [];
    for (const [k, a] of after) {
      const b = before.get(k);
      if (!b) continue;
      if (b.def !== a.def) changed.push(k);
      expect({ k, volatile: a.volatile, secdef: a.secdef, config: a.config, acl: a.acl }).toEqual({ k, volatile: b.volatile, secdef: b.secdef, config: b.config, acl: b.acl });
    }
    expect(changed.sort()).toEqual(CHANGED);
    const file = join(import.meta.dirname, "packages-drift.expected.json");
    if (process.env.T076_WRITE_EXPECTED) {
      writeFileSync(file, JSON.stringify({ before: Object.fromEntries(CHANGED.map((k) => [k, sha(before.get(k)!.def)])),
        after: Object.fromEntries(CHANGED.map((k) => [k, sha(after.get(k)!.def)])) }, null, 2) + "\n");
    }
    const expected = JSON.parse(readFileSync(file, "utf8")) as { before: Record<string, string>; after: Record<string, string> };
    for (const k of CHANGED) {
      expect(sha(before.get(k)!.def), `${k} before`).toBe(expected.before[k]);
      expect(sha(after.get(k)!.def), `${k} after`).toBe(expected.after[k]);
    }
    expect(after.get("invoice_issue(text,uuid,jsonb)")!.def).toContain("package_open(i, a.staff_id, a.role, v_at)");
    expect([...before.keys()].filter((x) => !after.has(x))).toEqual(DROPPED);
  });

  it("the added functions are the package ones; only the writers, readers, the scan and the read predicates are granted to clinic_app", () => {
    const added = [...after.keys()].filter((k) => !before.has(k)).sort();
    const app = [
      "package_reserve(text,uuid,uuid,jsonb)", "package_release(uuid)", "package_cancel(uuid,text)", "package_expiry_scan(date)", "interrupted_to_balance(text,uuid)",
      "package_substitution_request(text,uuid,jsonb)", "package_substitution_decide(uuid,boolean,text)", "balance_top_up(text,uuid,uuid,jsonb)",
      "package_contents_set(uuid,jsonb)", "package_patient_get(uuid)", "package_patient_search(text)", "package_contents_get(uuid)",
      "package_readable(uuid)", "package_contents_readable(uuid)",
    ];
    const internal = [
      "package_allocate(bigint,bigint[])", "package_line(packages)", "package_paid(packages)", "package_taken(packages)", "package_execution_covered(uuid,uuid)",
      "package_plan_service(uuid,uuid)", "package_session_settled(package_sessions)", "package_covering_session(uuid,uuid,uuid)", "package_on_visit(uuid,uuid)",
      "invoice_is_ordinary(uuid,uuid)", "package_sync_vat(uuid,uuid,timestamp with time zone)", "package_audit_service(uuid,text,text,uuid,text,text)",
      "package_contents_guard()", "package_contents_carry()", "packages_guard()", "package_sessions_guard()", "package_substitutions_guard()",
      "package_open(invoices,uuid,text,timestamp with time zone)", "package_actor(text[])", "package_locked(uuid,uuid)",
      "package_session_back(package_sessions,uuid,text,uuid,text)", "package_execution_bind()", "package_execution_finish()", "package_visit_closed()",
      "package_close_do(packages,text,text,uuid,text,timestamp with time zone)", "package_row(packages)",
      "invoice_line_snapshot(invoices,uuid,integer,bigint,timestamp with time zone,uuid,uuid)",
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
    for (const [k, v] of checksBefore) if (k !== "payment_allocations.payment_allocations_check") expect(checksAfter.get(k), k).toBe(v);
    expect(checksAfter.get("payment_allocations.payment_allocations_check")).toContain("num_nonnulls(invoice_line_id, top_up_id) = 1");
  });

  it("the new triggers are enabled always", async () => {
    const names = ["package_contents_guard", "catalog_versions_package_contents", "packages_guard", "package_sessions_guard", "package_substitutions_guard",
      "balance_top_ups_insert_only", "treatment_executions_00_package_bind", "treatment_executions_00_package_finish", "visits_package_release",
      "package_contents_no_truncate", "packages_no_truncate", "package_sessions_no_truncate", "package_substitutions_no_truncate", "balance_top_ups_no_truncate"];
    const t = (await h.admin.query(`select tgname, tgenabled from pg_trigger where tgname = any($1)`, [names])).rows;
    expect(t).toHaveLength(names.length);
    expect(t.every((x) => x.tgenabled === "A")).toBe(true);
    // The package finish fires before the additions trigger (r2 F5): AFTER triggers run in name order.
    expect("treatment_executions_00_package_finish" < "treatment_executions_addition_finished").toBe(true);
  });
});
