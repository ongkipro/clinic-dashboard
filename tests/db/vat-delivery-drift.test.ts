// HYG-023 drift check (Panel 2 Q1–Q5, S7, S8; 2026-11-18): migration 0122 re-creates exactly five writers — treatment_finish, invoice_issue,
// consultation_invoice_issue, discount_sync (each gains ONE marked block -- HYG-023 A-12 >> … << that only calls vat_line_deliver) and
// invoice_void_sync (ONE marked block that reverses the voided lines' recognised VAT: vat_reversed_* and a line_void vat_events row) —
// each with its signature, attributes and grants: removing the block gives the old body line for line. A database is migrated to exactly
// 0121, then to exactly 0122 and compared: every other function and policy stays byte-identical, the only constraint changed is
// vat_events_check (its cause list gains line_delivery and line_void, nothing else), the only function added is vat_line_deliver (not granted).
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
  const toBefore = migrationsUpTo("0121_subledgers");
  const toAfter = migrationsUpTo("0122_vat_delivery");
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

const CHANGED = ["consultation_invoice_issue(visits,uuid,bigint,text,uuid,text,timestamp with time zone)", "discount_sync()", "invoice_issue(text,uuid,jsonb)",
  "invoice_void_sync()", "treatment_finish(text,uuid,jsonb)"];
const REVERSER = "invoice_void_sync()";
const ADDED = ["vat_line_deliver(uuid,uuid,bigint,bigint,timestamp with time zone,uuid)"];
const strip = (def: string) => def.replace(/^ {2}-- HYG-023 A-12 >>\n[\s\S]*?^ {2}-- HYG-023 A-12 <<\n/m, "");

describe("HYG-023: migration 0122 — five writers gain one marked block each; nothing else existing changes", () => {
  it("re-creates exactly the five writers (attributes and grants kept), adds only vat_line_deliver (not granted), drops nothing", () => {
    const changed: string[] = [];
    for (const [k, a] of after) {
      const b = before.get(k);
      if (!b) continue;
      if (b.def !== a.def) changed.push(k);
      expect({ k, volatile: a.volatile, secdef: a.secdef, config: a.config, acl: a.acl }).toEqual({ k, volatile: b.volatile, secdef: b.secdef, config: b.config, acl: b.acl });
    }
    expect(changed.sort()).toEqual(CHANGED);
    expect([...after.keys()].filter((k) => !before.has(k)).sort()).toEqual(ADDED);
    expect([...before.keys()].filter((k) => !after.has(k))).toEqual([]);
    expect(after.get(ADDED[0])!.acl?.includes("clinic_app=X") ?? false).toBe(false);
    expect(after.get(ADDED[0])!.secdef).toBe(false);
    const file = join(import.meta.dirname, "vat-delivery-drift.expected.json");
    if (process.env.HYG023_WRITE_EXPECTED) {
      writeFileSync(file, JSON.stringify({ before: Object.fromEntries(CHANGED.map((k) => [k, sha(before.get(k)!.def)])),
        after: Object.fromEntries([...CHANGED, ...ADDED].map((k) => [k, sha(after.get(k)!.def)])) }, null, 2) + "\n");
    }
    const expected = JSON.parse(readFileSync(file, "utf8")) as { before: Record<string, string>; after: Record<string, string> };
    for (const k of CHANGED) expect(sha(before.get(k)!.def), `${k} before`).toBe(expected.before[k]);
    for (const k of [...CHANGED, ...ADDED]) expect(sha(after.get(k)!.def), `${k} after`).toBe(expected.after[k]);
  });

  it("each new body minus its one marked block is the old body line for line; four blocks only call vat_line_deliver, the void block only reverses", () => {
    for (const k of CHANGED) {
      const a = after.get(k)!.def;
      expect(a.match(/-- HYG-023 A-12 >>/g)?.length, k).toBe(1);
      const blk = a.slice(a.indexOf("-- HYG-023 A-12 >>"), a.indexOf("-- HYG-023 A-12 <<"));
      if (k === REVERSER) {
        // the only writes: vat_reversed_* of the voided invoice's lines and one line_void event each; never the recognition
        expect(blk.match(/\bUPDATE public\.\w+/g), k).toEqual(["UPDATE public.invoice_lines"]);
        expect(blk.match(/\bINSERT INTO public\.\w+/g), k).toEqual(["INSERT INTO public.vat_events"]);
        expect(blk, k).toMatch(/SET vat_reversed_amount = vat_recognised_amount, vat_reversed_at = coalesce\(vat_reversed_at, v_void_at\)/);
        expect(blk, k).toMatch(/'line_void', NEW\.id\)/);
        expect(blk, k).not.toMatch(/DELETE|vat_recognised_amount =/);
      } else {
        expect(blk, k).toMatch(/PERFORM public\.vat_line_deliver\(/);
        expect(blk, k).not.toMatch(/\b(UPDATE|INSERT|DELETE)\b/);
      }
      expect(strip(a), k).toBe(before.get(k)!.def);
    }
  });

  it("no existing policy changed; the only constraint changed is vat_events_check, gaining exactly line_delivery and line_void", () => {
    for (const [k, v] of policiesBefore) expect(policiesAfter.get(k), k).toBe(v);
    for (const [k, v] of checksBefore) {
      if (k === "vat_events.vat_events_check") expect(checksAfter.get(k)).toBe(v.replace("'session_attribution'::text]", "'session_attribution'::text, 'line_delivery'::text, 'line_void'::text]"));
      else expect(checksAfter.get(k), k).toBe(v);
    }
    expect([...checksAfter.keys()].filter((k) => !checksBefore.has(k))).toEqual([]);
  });
});
