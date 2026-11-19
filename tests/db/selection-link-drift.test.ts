// T-105 G-Q4 S1 drift check (owner 2026-11-19; migration 0124): a database migrated to exactly 0123, then to exactly 0124, compared.
// Re-created functions: invoice_issue, invoice_lines_guard, kasir_visit_lines (Kasir), dispense_hand_over and discount_sync (r8: one marked
// block each that only calls vat_line_deliver — delivery VAT for linked products) and ledger_wake_visit, ledger_rule_reversal,
// ledger_rule_product_handed (ledger) — each new body minus its marked blocks (-- T-105 G-Q4 S1 >> … <<) is the old body line for line,
// except ledger_rule_product_handed, whose (visit, catalog item, earliest line) inference is replaced (asserted: the old body had it, the new
// one has none). Attributes and grants kept. Added: ledger_rule_product_line and app_selection_link (neither granted) and the read-only
// accounting-exception reader ledger_handover_exceptions (granted to clinic_app; ledger_actor owner / finance / auditor). No policy changes; the
// only constraints added are on invoice_lines (selection key and FK); no existing constraint changed.
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
const snap: Record<"before" | "after", { policies: Map<string, string>; checks: Map<string, string> }> = {} as never;
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
async function tables(db: pg.ClientBase) {
  const p = await db.query<{ k: string; v: string }>(
    `select c.relname || '.' || p.polname as k, p.polcmd::text || ' ' || p.polroles::text || ' ' || coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') as v
       from pg_policy p join pg_class c on c.oid = p.polrelid`);
  const c = await db.query<{ k: string; v: string }>(
    `select c.relname || '.' || k.conname as k, pg_get_constraintdef(k.oid) as v from pg_constraint k join pg_class c on c.oid = k.conrelid
      join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'`);
  return { policies: new Map(p.rows.map((x) => [x.k, x.v])), checks: new Map(c.rows.map((x) => [x.k, x.v])) };
}

beforeAll(async () => {
  const toBefore = migrationsUpTo("0123_ledger");
  const toAfter = migrationsUpTo("0124_selection_link");
  dirs = [toBefore, toAfter];
  let url = "";
  h = await createHarness({ migrate: async (u) => { url = u; await runMigrations(u, { folder: toBefore }); } });
  before = await capture(h.admin);
  snap.before = await tables(h.admin);
  await runMigrations(url, { folder: toAfter });
  after = await capture(h.admin);
  snap.after = await tables(h.admin);
}, 300_000);

afterAll(async () => {
  await h?.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const MARKED = ["discount_sync()", "dispense_hand_over(text,uuid,jsonb)", "invoice_issue(text,uuid,jsonb)", "invoice_lines_guard()", "kasir_visit_lines(uuid)",
  "ledger_rule_reversal(uuid,text,uuid,uuid)", "ledger_wake_visit(uuid,uuid)"];
// r8 G-VAT-S1 (Panel 2 r7 REVISE): delivery VAT for exact S1-linked visit products — blocks that only call vat_line_deliver
const R8 = ["discount_sync()", "dispense_hand_over(text,uuid,jsonb)", "invoice_issue(text,uuid,jsonb)"];
const REPLACED = "ledger_rule_product_handed(uuid,uuid,uuid)";
const ADDED = ["app_selection_link()", "ledger_rule_product_line(uuid,uuid,uuid,text,uuid)"];
const READER = "ledger_handover_exceptions(date,date,uuid)"; // G-Q4 U1–U4 (Panel 2): granted, read-only, counts only
const strip = (def: string) => def.replace(/^ {2}-- T-105 (G-Q4 S1|r8 G-VAT-S1) >>\n[\s\S]*?^ {2}-- T-105 \1 <<\n/gm, "");

describe("T-105 G-Q4 S1: migration 0124 changes exactly the named functions and invoice_lines", () => {
  it("re-creates exactly the marked writers and the product rule (attributes and grants kept); adds two ungranted functions; drops nothing", () => {
    const changed: string[] = [];
    for (const [k, a] of after) {
      const b = before.get(k);
      if (!b) continue;
      if (b.def !== a.def) changed.push(k);
      expect({ k, volatile: a.volatile, secdef: a.secdef, config: a.config, acl: a.acl }).toEqual({ k, volatile: b.volatile, secdef: b.secdef, config: b.config, acl: b.acl });
    }
    expect(changed.sort()).toEqual([...MARKED, REPLACED].sort());
    expect([...after.keys()].filter((k) => !before.has(k)).sort()).toEqual([...ADDED, READER].sort());
    expect([...before.keys()].filter((k) => !after.has(k))).toEqual([]);
    for (const k of ADDED) expect(after.get(k)!.acl?.includes("clinic_app=X") ?? false, k).toBe(false);
    expect([after.get(READER)!.acl?.includes("clinic_app=X"), after.get(READER)!.secdef, after.get(READER)!.def]).toEqual([true, true, expect.stringContaining("ledger_actor(ARRAY['owner','finance','auditor'])")]);
    expect(after.get(READER)!.def).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
  });

  it("each marked writer minus its marked blocks is the old body line for line; the product rule loses the inference", () => {
    for (const k of MARKED) {
      const a = after.get(k)!.def;
      expect(a.match(/-- T-105 (G-Q4 S1|r8 G-VAT-S1) >>/g)?.length ?? 0, k).toBeGreaterThan(0);
      expect(strip(a), k).toBe(before.get(k)!.def);
    }
    for (const k of R8) {
      const a = after.get(k)!.def;
      const blocks = [...a.matchAll(/-- T-105 r8 G-VAT-S1 >>\n([\s\S]*?)-- T-105 r8 G-VAT-S1 <</g)].map((m) => m[1]);
      expect(blocks.length, k).toBe(1);
      expect(blocks[0], k).toMatch(/PERFORM public\.vat_line_deliver\(/);
      expect(blocks[0], k).not.toMatch(/\b(UPDATE|INSERT|DELETE)\b/);
    }
    const old = before.get(REPLACED)!.def; const now = after.get(REPLACED)!.def;
    expect(old).toMatch(/il\.item_id = si\.catalog_item_id/);
    expect(now).not.toMatch(/catalog_item_id/);
    expect(now).toMatch(/il\.selection_item_id = d\.selection_item_id AND i\.state = 'issued'/);
  });

  it("no policy changed; existing constraints unchanged; added only the invoice_lines selection key and FK", () => {
    for (const [k, v] of snap.before.policies) expect(snap.after.policies.get(k), k).toBe(v);
    expect([...snap.after.policies.keys()].filter((k) => !snap.before.policies.has(k))).toEqual([]);
    for (const [k, v] of snap.before.checks) expect(snap.after.checks.get(k), k).toBe(v);
    expect([...snap.after.checks.keys()].filter((k) => !snap.before.checks.has(k)).sort()).toEqual(["invoice_lines.invoice_lines_selection_fk", "invoice_lines.invoice_lines_selection_key"]);
  });
});
