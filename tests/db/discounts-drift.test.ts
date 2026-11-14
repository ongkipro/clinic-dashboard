// T-080 drift check: the discounts migration (0096) adds invoice_lines.discount_kind and discount_approval_id (backfilled: a
// pre-0096 line with a discount is 'manual'), the manual_discount approval type, the SET-12 limit, the decision trigger and the
// payable outstanding, and re-creates exactly the declared functions, each with its signature and attributes: the snapshot
// (invoice_line_snapshot: dropped and re-created with p_role), invoice_issue, the line guard, the payment paths that skip a
// pending discount line (kasir_record_payment, payment_line_room, payment_charge_create, payment_receive,
// payment_allocations_guard, deposit_apply_do, receivable_convert), invoice_void_request, kasir_invoice_get and packages_guard (the
// canonical patient of a deferred package). Added: the report reader discount_manual_list (owner, auditor). A database is
// migrated to exactly 0095, then to exactly 0096 and compared (sha-256 in discounts-drift.expected.json).
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
  const toBefore = migrationsUpTo("0095_consultation");
  const toAfter = migrationsUpTo("0096_discounts");
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
  "deposit_apply_do(invoices,booking_deposits,uuid,text)", "invoice_issue(text,uuid,jsonb)", "invoice_lines_guard()", "invoice_void_request(uuid,text)",
  "kasir_invoice_get(uuid)", "kasir_record_payment(invoices,text,jsonb,jsonb,uuid,text,timestamp with time zone)", "packages_guard()", "payment_allocations_guard()",
  "payment_charge_create(text,uuid,jsonb)", "payment_line_room(uuid,uuid,boolean)", "payment_receive(text,uuid,jsonb)", "receivable_convert(text,uuid)",
].sort();
// invoice_line_snapshot gains p_role: the 7-argument version is dropped, the 8-argument one added.
const DROPPED = "invoice_line_snapshot(invoices,uuid,integer,bigint,timestamp with time zone,uuid,uuid)";
const REPLACEMENT = "invoice_line_snapshot(invoices,uuid,integer,bigint,timestamp with time zone,uuid,uuid,text)";

describe("T-080: the discounts migration re-creates only the declared functions", () => {
  it("the changed ones are exactly the declared set, attributes kept; only the 7-argument snapshot dropped", () => {
    const changed: string[] = [];
    for (const [k, a] of after) {
      const b = before.get(k);
      if (!b) continue;
      if (b.def !== a.def) changed.push(k);
      expect({ k, volatile: a.volatile, secdef: a.secdef, config: a.config, acl: a.acl }).toEqual({ k, volatile: b.volatile, secdef: b.secdef, config: b.config, acl: b.acl });
    }
    expect(changed.sort()).toEqual(CHANGED);
    expect([...before.keys()].filter((x) => !after.has(x))).toEqual([DROPPED]);
    const file = join(import.meta.dirname, "discounts-drift.expected.json");
    if (process.env.T080_WRITE_EXPECTED) {
      writeFileSync(file, JSON.stringify({ before: Object.fromEntries([...CHANGED, DROPPED].sort().map((k) => [k, sha(before.get(k)!.def)])),
        after: Object.fromEntries([...CHANGED, REPLACEMENT].sort().map((k) => [k, sha(after.get(k)!.def)])) }, null, 2) + "\n");
    }
    const expected = JSON.parse(readFileSync(file, "utf8")) as { before: Record<string, string>; after: Record<string, string> };
    for (const k of [...CHANGED, DROPPED]) expect(sha(before.get(k)!.def), `${k} before`).toBe(expected.before[k]);
    for (const k of [...CHANGED, REPLACEMENT]) expect(sha(after.get(k)!.def), `${k} after`).toBe(expected.after[k]);
    const rb = before.get(DROPPED)!; const ra = after.get(REPLACEMENT)!;
    expect([ra.volatile, ra.secdef, ra.config]).toEqual([rb.volatile, rb.secdef, rb.config]);
    expect(ra.acl ?? "").not.toMatch(/clinic_(app|vendor|executor|operator)=X\//);
  });

  it("the added functions are the discount ones; only the inbox helper and the report are granted to clinic_app", () => {
    const added = [...after.keys()].filter((k) => !before.has(k)).sort();
    const app = ["approval_manager_decides_discount(uuid)", "discount_manual_list(uuid)"];
    const internal = [REPLACEMENT, "discount_within_limit(text,bigint,bigint,timestamp with time zone)", "discount_pending(uuid,uuid)", "kasir_payable(uuid,uuid)",
      "package_check_open(invoices,timestamp with time zone)", "discount_sync()"];
    expect(added).toEqual([...app, ...internal].sort());
    for (const k of added) {
      const acl = after.get(k)!.acl ?? "";
      expect(after.get(k)!.acl, k).not.toBeNull();
      if (app.includes(k)) expect(acl, k).toMatch(/clinic_app=X\//);
      else expect(acl, k).not.toMatch(/clinic_(app|vendor|executor|operator)=X\//);
      expect(acl, k).not.toMatch(/[{,]=X\//);
    }
  });

  it("no existing policy or constraint changed; the discount check and FK added", () => {
    for (const [k, v] of policiesBefore) expect(policiesAfter.get(k), k).toBe(v);
    expect([...checksBefore.keys()].filter((k) => checksAfter.get(k) !== checksBefore.get(k))).toEqual([]);
    expect(checksAfter.get("invoice_lines.invoice_lines_discount_check")).toContain("discount_kind");
    expect(checksAfter.get("invoice_lines.invoice_lines_discount_approval_fk")).toContain("REFERENCES approvals");
  });

  it("the decision trigger is enabled always; the approval type is registered", async () => {
    const t = (await h.admin.query(`select tgenabled from pg_trigger where tgname = 'approvals_discount_sync'`)).rows;
    expect(t).toEqual([{ tgenabled: "A" }]);
    expect((await h.admin.query(`select approver_roles::text, requester_roles::text, owner_self from approval_types where key = 'manual_discount'`)).rows)
      .toEqual([{ approver_roles: "{owner,manager}", requester_roles: "{fo_cashier,manager,finance}", owner_self: false }]);
  });
});
