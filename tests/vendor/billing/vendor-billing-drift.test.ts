// T-103 drift check (plan r4 §Expansion): migration 0119 only adds — the billing tables, their guards and RLS, a seed row in
// notification_types, scope_map rows, and the vendor_billing_* functions with exact grants. No existing function, policy, check or trigger is
// re-created or changed. A database is migrated to exactly 0118, then to exactly 0119.
import { rmSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../../src/db/migrate";
import { migrationsUpTo } from "../../db/migrations-up-to";
import { createHarness, type Harness } from "../../rls/harness";

type Fn = { def: string; secdef: boolean; config: string | null; acl: string | null };
let h: Harness;
let before: Map<string, Fn>;
let after: Map<string, Fn>;
const snap: Record<"before" | "after", { policies: Map<string, string>; checks: Map<string, string>; triggers: Map<string, string> }> = {} as never;
let dirs: string[] = [];

async function capture(db: pg.ClientBase): Promise<Map<string, Fn>> {
  const r = await db.query<{ k: string; def: string; secdef: boolean; config: string[] | null; acl: string | null }>(
    `select p.oid::regprocedure::text as k, pg_get_functiondef(p.oid) as def, p.prosecdef as secdef, p.proconfig as config, p.proacl::text as acl
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind = 'f'
        and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')`);
  return new Map(r.rows.map((x) => [x.k, { def: x.def, secdef: x.secdef, config: x.config?.join(";") ?? null, acl: x.acl }]));
}
const kv = async (db: pg.ClientBase, sql: string) => new Map((await db.query<{ k: string; v: string }>(sql)).rows.map((x) => [x.k, x.v]));
const policies = (db: pg.ClientBase) => kv(db, `select c.relname || '.' || p.polname as k, p.polcmd::text || ' ' || p.polroles::text || ' ' || coalesce(pg_get_expr(p.polqual, p.polrelid), '') as v
  from pg_policy p join pg_class c on c.oid = p.polrelid`);
const checks = (db: pg.ClientBase) => kv(db, `select c.relname || '.' || k.conname as k, pg_get_constraintdef(k.oid) as v from pg_constraint k join pg_class c on c.oid = k.conrelid
  join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'`);
const triggers = (db: pg.ClientBase) => kv(db, `select c.relname || '.' || t.tgname as k, pg_get_triggerdef(t.oid) || ' ' || t.tgenabled::text as v from pg_trigger t join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not t.tgisinternal`);

beforeAll(async () => {
  const toBefore = migrationsUpTo("0118_satusehat_page");
  const toAfter = migrationsUpTo("0119_vendor_billing");
  dirs = [toBefore, toAfter];
  let url = "";
  h = await createHarness({ migrate: async (u) => { url = u; await runMigrations(u, { folder: toBefore }); } });
  before = await capture(h.admin);
  snap.before = { policies: await policies(h.admin), checks: await checks(h.admin), triggers: await triggers(h.admin) };
  await runMigrations(url, { folder: toAfter });
  after = await capture(h.admin);
  snap.after = { policies: await policies(h.admin), checks: await checks(h.admin), triggers: await triggers(h.admin) };
}, 300_000);
afterAll(async () => {
  await h?.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

// The functions 0119 adds and who may execute each (nothing else is granted; helpers are revoked from PUBLIC and granted to no role).
const GRANTS: Record<string, string | null> = {
  "vendor_billing_bayar_begin(text,uuid,text,text[],timestamp with time zone)": "clinic_app",
  "vendor_billing_tenant_view()": "clinic_app",
  "vendor_billing_issue(timestamp with time zone,text)": "clinic_executor",
  "vendor_billing_bayar_finish(uuid,integer,text,jsonb,timestamp with time zone,text)": "clinic_executor",
  "vendor_billing_recover(timestamp with time zone,text)": "clinic_executor",
  "vendor_billing_advice_due(timestamp with time zone,integer)": "clinic_executor",
  "vendor_billing_advice_record(uuid,integer,jsonb,timestamp with time zone,text)": "clinic_executor",
  "vendor_billing_apply_fee_change(uuid,uuid,text)": "clinic_executor",
  "vendor_billing_apply_waiver(uuid,uuid,text)": "clinic_executor",
  "vendor_billing_reminders(timestamp with time zone,text)": "clinic_executor",
  "vendor_billing_guard()": null,
  "vendor_billing_lock(uuid)": null,
  "vendor_invoice_outstanding(uuid)": null,
  "vendor_invoice_settle_state(uuid)": null,
  "vendor_billing_allocate(uuid,uuid)": null,
  "vendor_billing_review(uuid,text,uuid,text)": null,
  "vendor_billing_vat(integer,date)": null,
  "vendor_billing_exit_credit(uuid,date,text)": null,
};

describe("T-103: 0118 → 0119 only adds", () => {
  it("every existing function unchanged; the added functions are exactly the list, each granted only as listed", () => {
    for (const [k, f] of before) {
      expect({ k, def: after.get(k)?.def, acl: after.get(k)?.acl, secdef: after.get(k)?.secdef, config: after.get(k)?.config }).toEqual({ k, def: f.def, acl: f.acl, secdef: f.secdef, config: f.config });
    }
    const added = [...after.keys()].filter((k) => !before.has(k)).sort();
    expect(added).toEqual(Object.keys(GRANTS).sort());
    for (const [k, role] of Object.entries(GRANTS)) {
      const acl = after.get(k)!.acl ?? "";
      expect({ k, acl: acl !== "" }).toEqual({ k, acl: true }); // revoked from PUBLIC → an explicit ACL
      expect(acl, k).not.toMatch(/(^|[{,])=X/);
      const grantees = [...acl.matchAll(/(clinic_[a-z]+)=X\//g)].map((m) => m[1]).sort();
      expect({ k, grantees }).toEqual({ k, grantees: role ? [role] : [] });
    }
    for (const k of ["vendor_billing_bayar_begin(text,uuid,text,text[],timestamp with time zone)", "vendor_billing_tenant_view()", "vendor_billing_issue(timestamp with time zone,text)",
      "vendor_billing_advice_record(uuid,integer,jsonb,timestamp with time zone,text)", "vendor_billing_apply_waiver(uuid,uuid,text)"]) {
      expect({ k, secdef: after.get(k)!.secdef, config: after.get(k)!.config }).toEqual({ k, secdef: true, config: "search_path=pg_catalog, pg_temp" });
    }
  });
  it("no existing check, policy or trigger changed; only billing-table checks and triggers added; no policy (deny by default)", () => {
    for (const x of ["policies", "checks", "triggers"] as const) {
      for (const [k, v] of snap.before[x]) expect(snap.after[x].get(k), `${x} ${k}`).toBe(v);
    }
    const BILLING = /^(server_fee_versions|vendor_invoices|vendor_payment_attempts|vendor_advice_observations|autolaris_settlement_rules|vendor_payments|vendor_payment_allocations|vendor_credit_notes|vendor_credit_allocations|vendor_attempt_notes|vendor_billing_policy|vendor_reminders|vendor_billing_reviews)\./;
    for (const x of ["checks", "triggers"] as const) {
      const added = [...snap.after[x].keys()].filter((k) => !snap.before[x].has(k));
      expect(added.filter((k) => !BILLING.test(k)), x).toEqual([]);
    }
    expect([...snap.after.policies.keys()].filter((k) => !snap.before.policies.has(k))).toEqual([]);
  });
});
