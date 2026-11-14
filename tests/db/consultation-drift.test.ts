// T-079 drift check: the consultation migration (0095) adds consultation_fees, consultation_fee_purchases and consultation_controls
// with their writers, readers, the close decision and the re-charge, the invoices.consultation flag, and re-creates exactly the
// declared functions, each with its signature and attributes: the fee decided at close (visit_close), the re-charge from a refund
// (refund_settle: dropped and re-created with the new OUT o_deducted; refund_request, refund_pay) or a package cancel
// (package_close_do, package_cancel), the consultation invoice kept out of ordinary issue (invoice_is_ordinary, invoices_guard,
// invoice_issue), the Kasir queue and row (kasir_queue, kasir_invoice_row), and a fee line delivered but never refunded
// (refund_line_delivered, refunds_guard, refund_line_options, refund_invoice_picks). A database is migrated to exactly 0094, then
// to exactly 0095 and compared (sha-256 of both versions of the changed ones in consultation-drift.expected.json).
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
  const toBefore = migrationsUpTo("0094_receivables");
  const toAfter = migrationsUpTo("0095_consultation");
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
  "invoice_is_ordinary(uuid,uuid)", "invoice_issue(text,uuid,jsonb)", "invoices_guard()", "kasir_invoice_row(invoices,boolean)", "kasir_queue(uuid)",
  "package_cancel(uuid,text)", "package_close_do(packages,text,text,uuid,text,timestamp with time zone)", "refund_invoice_picks()",
  "refund_line_delivered(invoice_lines,invoices)", "refund_line_options(uuid)", "refund_pay(text,uuid,jsonb)", "refund_request(text,uuid,jsonb)",
  "refunds_guard()", "visit_close(uuid)",
].sort();
// refund_settle keeps its argument list but gains OUT o_deducted: same regprocedure key, re-created by DROP + CREATE.
const RECREATED = "refund_settle(refunds,uuid,text,text)";

describe("T-079: the consultation migration re-creates only the declared functions", () => {
  it("no function dropped; the changed ones are exactly the declared set, attributes kept", () => {
    const changed: string[] = [];
    for (const [k, a] of after) {
      const b = before.get(k);
      if (!b || k === RECREATED) continue;
      if (b.def !== a.def) changed.push(k);
      expect({ k, volatile: a.volatile, secdef: a.secdef, config: a.config, acl: a.acl }).toEqual({ k, volatile: b.volatile, secdef: b.secdef, config: b.config, acl: b.acl });
    }
    expect(changed.sort()).toEqual(CHANGED);
    const all = [...CHANGED, RECREATED].sort();
    const file = join(import.meta.dirname, "consultation-drift.expected.json");
    if (process.env.T079_WRITE_EXPECTED) {
      writeFileSync(file, JSON.stringify({ before: Object.fromEntries(all.map((k) => [k, sha(before.get(k)!.def)])),
        after: Object.fromEntries(all.map((k) => [k, sha(after.get(k)!.def)])) }, null, 2) + "\n");
    }
    const expected = JSON.parse(readFileSync(file, "utf8")) as { before: Record<string, string>; after: Record<string, string> };
    for (const k of all) {
      expect(sha(before.get(k)!.def), `${k} before`).toBe(expected.before[k]);
      expect(sha(after.get(k)!.def), `${k} after`).toBe(expected.after[k]);
    }
    expect([...before.keys()].filter((x) => !after.has(x))).toEqual([]);
    // the re-created refund_settle: internal still, new OUT parameter, same volatility and search_path
    const rb = before.get(RECREATED)!; const ra = after.get(RECREATED)!;
    expect([ra.volatile, ra.secdef, ra.config]).toEqual([rb.volatile, rb.secdef, rb.config]);
    expect(ra.acl ?? "").not.toMatch(/clinic_(app|vendor|executor|operator)=X\//);
    expect(ra.def).toContain("OUT o_deducted bigint");
  });

  it("the added functions are the consultation ones; only the writers and readers are granted to clinic_app", () => {
    const added = [...after.keys()].filter((k) => !before.has(k)).sort();
    const app = ["consultation_fee_charge(text,uuid,jsonb)", "consultation_fee_exempt(text,uuid,jsonb)", "control_schedule(text,uuid,jsonb)",
      "consultation_fee_get(uuid)", "control_list(uuid)"];
    const internal = [
      "consultation_fee_amount(timestamp with time zone)", "consultation_item_is(uuid,uuid)", "consultation_item(uuid,uuid)", "consultation_visit(uuid,uuid)",
      "consultation_live_invoice(uuid,uuid)", "consultation_line_refunded(uuid,uuid,uuid,bigint)", "consultation_qualifying_lines(visits,timestamp with time zone)",
      "consultation_valid_control(visits,timestamp with time zone)", "consultation_fees_guard()", "consultation_controls_guard()",
      "consultation_invoice_issue(visits,uuid,bigint,text,uuid,text,timestamp with time zone)", "consultation_fee_on_close(visits,uuid,text)",
      "consultation_recharge_due(uuid,uuid,bigint)", "consultation_recharge(consultation_fees,text,uuid,bigint,uuid,text)", "consultation_controls_cancel(uuid,uuid,bigint)",
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

  it("no existing policy changed or dropped; no existing constraint changed; the consultation invoice check added", () => {
    for (const [k, v] of policiesBefore) expect(policiesAfter.get(k), k).toBe(v);
    const changedChecks = [...checksBefore.keys()].filter((k) => checksAfter.get(k) !== checksBefore.get(k)).sort();
    expect(changedChecks).toEqual([]);
    expect(checksAfter.get("invoices.invoices_consultation_check")).toContain("consultation");
    expect(checksAfter.get("consultation_fees.consultation_fees_refund_fk")).toContain("DEFERRABLE INITIALLY DEFERRED");
  });

  it("the new triggers are enabled always", async () => {
    const names = ["consultation_fees_guard", "consultation_controls_guard", "consultation_fee_purchases_insert_only",
      "consultation_fees_no_truncate", "consultation_fee_purchases_no_truncate", "consultation_controls_no_truncate"];
    const t = (await h.admin.query(`select tgname, tgenabled from pg_trigger where tgname = any($1)`, [names])).rows;
    expect(t.map((x) => x.tgname).sort()).toEqual([...names].sort());
    expect(t.every((x) => x.tgenabled === "A")).toBe(true);
  });
});
