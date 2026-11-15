// T-087 drift check: the commission migration (0102) adds the eleven commission tables, their writers, readers and synchronous AFTER
// triggers on the settlement facts (payment_allocations, booking_deposits, treatment_executions, package_sessions, invoice_lines,
// packages, write_offs, invoices, selections, care_plans, approvals, memberships) and re-creates NO existing function (plan P2-1: no M4
// writer re-created; CHANGED = []). Every existing function stays byte-identical (sha-256 of the whole set in commission-drift.expected.json),
// no existing policy or check changes, and the new triggers are ENABLE ALWAYS. A database is migrated to exactly 0101, then to exactly 0102.
import { createHash } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
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
  const toBefore = migrationsUpTo("0101_cash_shifts");
  const toAfter = migrationsUpTo("0102_commission");
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

const APP = ["commission_attribute_sale(text,uuid,jsonb)", "commission_batch_export(uuid)", "commission_batch_get(uuid)", "commission_batch_mark_paid(uuid,text)",
  "commission_batch_open(text,text)", "commission_batch_submit(uuid)", "commission_batches_list()", "commission_mine(text)", "commission_readable(uuid,uuid)",
  "commission_rule_create(text,jsonb)", "commission_rule_decide(uuid,text)", "commission_rule_simulate(jsonb)", "commission_rule_version(text,uuid,jsonb)",
  "commission_rules_list()", "commission_rules_readable(uuid)", "guiding_bc_assign(text,uuid,uuid,text)", "staff_commission_receivable_decide(uuid,text,text)"];
const INTERNAL = ["commission_accrue_consultation(uuid,uuid)", "commission_accrue_execution(uuid,uuid)", "commission_examination_signed()", "payout_batch_children_guard()", "commission_accrue_fixed(uuid,uuid,text,uuid)", "commission_accrue_line(uuid,uuid,text,uuid)",
  "commission_accrue_line_performers(uuid,uuid)", "commission_accrue_percent(uuid,uuid,bigint,text,uuid)", "commission_adjustment_event()", "commission_allocation_accrue()",
  "commission_attribution_actor()", "commission_attribution_guard()", "commission_attribution_reconcile(uuid,uuid,uuid,text)", "commission_attribution_sync()",
  "commission_batch_actor(text[])", "commission_batch_sync()", "commission_care_plan_closed()", "commission_carry_in(uuid,uuid,timestamp with time zone)",
  "commission_collected_share(uuid,uuid,uuid)", "commission_contribution(uuid,uuid,uuid,text,text,uuid,uuid,timestamp with time zone)", "commission_contributions_guard()",
  "commission_deposit_accrue()", "commission_entitlement_event()", "commission_entitlement_sealed(uuid,uuid)", "commission_execution_accrue()",
  "commission_exit_receivables(uuid)", "commission_guiding_at(uuid,uuid,timestamp with time zone)", "commission_insert_only()", "commission_invoice_issued()",
  "commission_item_scopes(uuid,uuid)", "commission_line_basis(uuid,uuid)", "commission_line_fully_paid(uuid,uuid)", "commission_line_moved(uuid,uuid,bigint,text,text,uuid)",
  "commission_line_moved_trigger()", "commission_line_performers_reverse(uuid,uuid,text,text,uuid)", "commission_membership_ended()", "commission_package_closed()",
  "commission_period(uuid,text)", "commission_reader()", "commission_reduce(uuid,uuid,bigint,text,text,uuid)", "commission_reverse_contribution(uuid,uuid,text,text,uuid)",
  "commission_rows_json(uuid,uuid,timestamp with time zone,timestamp with time zone)",
  "commission_rule_actor(text[])", "commission_rule_at(uuid,text,uuid,text,uuid,text,boolean,timestamp with time zone)", "commission_rule_versions_guard()",
  "commission_rules_guard()", "commission_sale_attributions_frozen()", "commission_selection_seed()", "commission_session_accrue()", "commission_session_cheaper()",
  "commission_staff_role(uuid,uuid,text)", "commission_write_off()", "guiding_bc_assignments_frozen()", "payout_batches_guard()", "staff_commission_receivables_guard()"];
const TABLES = ["commission_adjustments", "commission_contributions", "commission_entitlements", "commission_rule_versions", "commission_rules", "commission_sale_attributions",
  "guiding_bc_assignments", "payout_batch_items", "payout_batch_lines", "payout_batches", "staff_commission_receivables"];
const TRIGGERS = ["approvals_commission_attribution_sync", "approvals_commission_batch_sync", "booking_deposits_commission", "care_plans_commission_closed",
  "commission_adjustments_event", "commission_adjustments_insert_only", "commission_contributions_guard", "commission_entitlements_event", "commission_entitlements_insert_only",
  "commission_rule_versions_guard", "commission_rules_guard", "examinations_commission_signed", "commission_sale_attributions_frozen", "commission_sale_attributions_guard", "guiding_bc_assignments_frozen",
  "guiding_bc_assignments_guard", "invoice_lines_commission_moved", "invoices_commission_issued", "memberships_commission_exit", "package_sessions_commission",
  "package_sessions_commission_cheaper", "packages_commission_closed", "payment_allocations_commission", "payout_batch_items_insert_only", "payout_batch_lines_insert_only",
  "payout_batches_guard", "selections_commission_seed", "staff_commission_receivables_guard", "treatment_executions_20_commission", "write_offs_commission"];

describe("T-087: the commission migration re-creates no existing function", () => {
  it("every existing function is byte-identical with its attributes; nothing dropped (the whole set's sha-256 pinned)", () => {
    const changed: string[] = [];
    for (const [k, a] of after) {
      const b = before.get(k);
      if (!b) continue;
      if (b.def !== a.def) changed.push(k);
      expect({ k, volatile: a.volatile, secdef: a.secdef, config: a.config, acl: a.acl }).toEqual({ k, volatile: b.volatile, secdef: b.secdef, config: b.config, acl: b.acl });
    }
    expect(changed).toEqual([]);
    expect([...before.keys()].filter((x) => !after.has(x))).toEqual([]);
    const whole = sha([...before.entries()].sort(([x], [y]) => (x < y ? -1 : 1)).map(([k, f]) => `${k}\n${f.def}`).join("\n"));
    const file = join(import.meta.dirname, "commission-drift.expected.json");
    if (process.env.T087_WRITE_EXPECTED) writeFileSync(file, `${JSON.stringify({ functions: before.size, before: whole }, null, 2)}\n`);
    const expected = JSON.parse(readFileSync(file, "utf8")) as { functions: number; before: string };
    expect([before.size, whole]).toEqual([expected.functions, expected.before]);
  });
  it("the added functions are exactly the commission ones; only the writers, readers and RLS predicates are granted to the app", () => {
    const added = [...after.keys()].filter((k) => !before.has(k)).sort();
    expect(added).toEqual([...APP, ...INTERNAL].sort());
    for (const k of added) {
      const acl = after.get(k)!.acl ?? "";
      expect(after.get(k)!.acl, k).not.toBeNull();
      if (APP.includes(k)) expect(acl, k).toMatch(/clinic_app=X\//);
      else expect(acl, k).not.toMatch(/clinic_(app|vendor|executor|operator)=X\//);
      expect(acl, k).not.toMatch(/[{,]=X\//);
    }
    // every definer pins its search path
    for (const k of added) if (after.get(k)!.secdef) expect(after.get(k)!.config, k).toBe("search_path=pg_catalog, pg_temp");
  });
  it("no existing policy or check changed", () => {
    for (const [k, v] of policiesBefore) expect(policiesAfter.get(k), k).toBe(v);
    expect([...checksBefore.keys()].filter((k) => checksAfter.get(k) !== checksBefore.get(k))).toEqual([]);
  });
  it("the eleven tables are RLS-protected and not writable by the app; the triggers are enabled always; free-text reasons never granted", async () => {
    const rls = (await h.admin.query(`select relname, relrowsecurity from pg_class where relname = any($1) and relkind = 'r' order by relname`, [TABLES])).rows;
    expect(rls.map((r) => [r.relname, r.relrowsecurity])).toEqual(TABLES.map((t) => [t, true]));
    for (const t of TABLES) {
      const p = (await h.admin.query(`select has_table_privilege('clinic_app', $1, 'INSERT') i, has_table_privilege('clinic_app', $1, 'UPDATE') u,
                                             has_table_privilege('clinic_app', $1, 'DELETE') d`, [`public.${t}`])).rows[0];
      expect([t, p.i, p.u, p.d]).toEqual([t, false, false, false]);
    }
    const t = (await h.admin.query(`select tgname, tgenabled from pg_trigger where tgname = any($1) order by tgname`, [[...TRIGGERS, ...TABLES.map((x) => `${x}_no_truncate`)]])).rows;
    expect(t.map((x) => [x.tgname, x.tgenabled])).toEqual([...TRIGGERS, ...TABLES.map((x) => `${x}_no_truncate`)].sort().map((n) => [n, "A"]));
    const g = (await h.admin.query(`select has_column_privilege('clinic_app', 'public.commission_sale_attributions', 'reason', 'SELECT') a,
                                           has_column_privilege('clinic_app', 'public.guiding_bc_assignments', 'reason', 'SELECT') b,
                                           has_column_privilege('clinic_app', 'public.staff_commission_receivables', 'decision_reason', 'SELECT') c,
                                           has_column_privilege('clinic_operator', 'public.staff_commission_receivables', 'decision_reason', 'SELECT') d,
                                           has_column_privilege('clinic_app', 'public.commission_entitlements', 'amount', 'SELECT') e`)).rows[0];
    expect([g.a, g.b, g.c, g.d, g.e]).toEqual([false, false, false, false, true]);
    // scope map and vendor classes for every table
    const sm = (await h.admin.query(`select count(*)::int n from scope_map where table_name = any($1)`, [TABLES.map((x) => `public.${x}`)])).rows[0].n;
    const sk = (await h.admin.query(`select count(*)::int n from support_object_kinds where table_name = any($1)`, [TABLES.map((x) => `public.${x}`)])).rows[0].n;
    expect([sm, sk]).toEqual([11, 11]);
  });
});
