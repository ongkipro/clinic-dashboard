// T-081 drift check: the promo migration (0097) adds promo_codes, promo_code_versions and promo_usages, widens
// invoice_lines_discount_check to the promo kind, and re-creates exactly the declared functions, each with its signature and
// attributes: the snapshot (invoice_line_snapshot: dropped and re-created with p_promo), invoice_issue, the line guard, the
// consumption points (kasir_record_payment, deposit_apply_do, receivable_convert, interrupted_to_balance), the release points
// (invoice_void_sync, package_close_do, refund_settle) and kasir_invoice_get. A database is migrated to exactly 0096, then to
// exactly 0097 and compared (sha-256 in promo-drift.expected.json).
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
  const toBefore = migrationsUpTo("0096_discounts");
  const toAfter = migrationsUpTo("0097_promo");
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
  "deposit_apply_do(invoices,booking_deposits,uuid,text)", "interrupted_to_balance(text,uuid)", "invoice_issue(text,uuid,jsonb)", "invoice_lines_guard()",
  "invoice_void_sync()", "kasir_invoice_get(uuid)", "kasir_record_payment(invoices,text,jsonb,jsonb,uuid,text,timestamp with time zone)",
  "package_close_do(packages,text,text,uuid,text,timestamp with time zone)", "receivable_convert(text,uuid)",
  "refund_settle(refunds,uuid,text,text)",
].sort();
// invoice_line_snapshot gains p_promo: the 8-argument version is dropped, the 9-argument one added.
const DROPPED = "invoice_line_snapshot(invoices,uuid,integer,bigint,timestamp with time zone,uuid,uuid,text)";
const REPLACEMENT = "invoice_line_snapshot(invoices,uuid,integer,bigint,timestamp with time zone,uuid,uuid,text,promo_code_versions)";

describe("T-081: the promo migration re-creates only the declared functions", () => {
  it("the changed ones are exactly the declared set, attributes kept; only the 8-argument snapshot dropped", () => {
    const changed: string[] = [];
    for (const [k, a] of after) {
      const b = before.get(k);
      if (!b) continue;
      if (b.def !== a.def) changed.push(k);
      expect({ k, volatile: a.volatile, secdef: a.secdef, config: a.config, acl: a.acl }).toEqual({ k, volatile: b.volatile, secdef: b.secdef, config: b.config, acl: b.acl });
    }
    expect(changed.sort()).toEqual(CHANGED);
    expect([...before.keys()].filter((x) => !after.has(x))).toEqual([DROPPED]);
    const file = join(import.meta.dirname, "promo-drift.expected.json");
    if (process.env.T081_WRITE_EXPECTED) {
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

  it("the added functions are the promo ones; only the management writers, the list, the hint and the read predicate are granted", () => {
    const added = [...after.keys()].filter((k) => !before.has(k)).sort();
    const app = ["promo_code_check(text,uuid,uuid,integer,uuid)", "promo_code_create(text,jsonb)", "promo_code_set(uuid,boolean,integer)",
      "promo_code_version(text,uuid,jsonb)", "promo_codes_list()", "promo_readable(uuid)"];
    const internal = [REPLACEMENT, "promo_actor()", "promo_branch_date(uuid,uuid,timestamp with time zone)", "promo_code_versions_guard()", "promo_codes_guard()",
      "promo_discount(promo_code_versions,bigint)", "promo_release(uuid,uuid,text,text)", "promo_resolve(uuid,text,uuid,uuid,uuid,timestamp with time zone)",
      "promo_take(uuid,uuid)", "promo_usage_sync(uuid,uuid)", "promo_usages_guard()",
      "promo_version_insert(uuid,uuid,text,jsonb,uuid,text)"];
    expect(added).toEqual([...app, ...internal].sort());
    for (const k of added) {
      const acl = after.get(k)!.acl ?? "";
      expect(after.get(k)!.acl, k).not.toBeNull();
      if (app.includes(k)) expect(acl, k).toMatch(/clinic_app=X\//);
      else expect(acl, k).not.toMatch(/clinic_(app|vendor|executor|operator)=X\//);
      expect(acl, k).not.toMatch(/[{,]=X\//);
    }
  });

  it("no existing policy changed; only the discount check widened (promo kind, never with an approval)", () => {
    for (const [k, v] of policiesBefore) expect(policiesAfter.get(k), k).toBe(v);
    expect([...checksBefore.keys()].filter((k) => checksAfter.get(k) !== checksBefore.get(k))).toEqual(["invoice_lines.invoice_lines_discount_check"]);
    expect(checksAfter.get("invoice_lines.invoice_lines_discount_check")).toMatch(/'manual'[^]*'promo'/);
    expect(checksAfter.get("invoice_lines.invoice_lines_discount_check")).toContain("IS DISTINCT FROM 'promo'");
  });

  it("the three tables are RLS-protected and never truncated; the guards are enabled always", async () => {
    const rls = (await h.admin.query(`select relname, relrowsecurity from pg_class where relname in ('promo_codes','promo_code_versions','promo_usages') order by relname`)).rows;
    expect(rls.map((r) => [r.relname, r.relrowsecurity])).toEqual([["promo_code_versions", true], ["promo_codes", true], ["promo_usages", true]]);
    const t = (await h.admin.query(`select tgname, tgenabled from pg_trigger where tgname like 'promo_%' order by tgname`)).rows;
    expect(t.every((x) => x.tgenabled === "A")).toBe(true);
    expect(t.map((x) => x.tgname)).toEqual(["promo_code_versions_guard", "promo_code_versions_no_truncate", "promo_codes_guard", "promo_codes_no_truncate",
      "promo_usages_guard", "promo_usages_no_truncate"]);
  });
});
