// T-104 drift check (Panel 2 C-7, addendum a1 r2): migration 0121 re-creates exactly the six VAT recording seams — package_execution_finish
// (S1, S1b), receivable_convert (S2), interrupted_to_balance (S3), package_close_do (S4), package_sync_vat (S5, S5b), deposit_apply_do (S6) — each
// with its signature, attributes and grants, and each new body is the old body plus vat_events INSERTs (and the reads they need: S4's
// package reversal after its own sync, S1b's recognition before it) only: removing those added lines from the new body gives the old body line for line. A database is
// migrated to exactly 0120, then to exactly 0121 and compared: every other existing function, policy and constraint stays byte-identical
// (sha-256 of both versions of the changed ones in subledgers-drift.expected.json); the added functions are the declared ones, granted to
// clinic_app only where the app calls them.
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
  const toBefore = migrationsUpTo("0120_vendor_billing_console");
  const toAfter = migrationsUpTo("0121_subledgers");
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
  "deposit_apply_do(invoices,booking_deposits,uuid,text)",
  "interrupted_to_balance(text,uuid)",
  "package_close_do(packages,text,text,uuid,text,timestamp with time zone)",
  "package_execution_finish()",
  "package_sync_vat(uuid,uuid,timestamp with time zone)",
  "receivable_convert(text,uuid)",
];
const ADDED = [
  "subledger_actor(text[],uuid)", "subledger_append_only()", "subledger_export(text,date,date,uuid,uuid)", "subledger_movements(uuid)",
  "subledger_period_ok(date,date)", "subledger_readable(uuid)", "subledger_rollforward(date,date,uuid)", "vat_cutover_open(uuid,timestamp with time zone)",
  "vat_fact_record(text,text,jsonb)", "vat_input_credit_record(text,jsonb)", "vat_payment_record(text,jsonb)",
];
const GRANTED = ["subledger_export(text,date,date,uuid,uuid)", "subledger_readable(uuid)", "subledger_rollforward(date,date,uuid)", "vat_input_credit_record(text,jsonb)", "vat_payment_record(text,jsonb)"];
// The added statements of a seam: every INSERT INTO public.vat_events with its VALUES / SELECT lines, the IF … END IF around it, and S4's
// one extra local and read. Removing them must give the old body exactly.
function strip(def: string): string {
  const lines = def.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    // the reads an added INSERT needs (S4's post-sync baseline, S1b's pre-sync recognition): a local and one SELECT INTO it
    if (/^\s*(v_rev_before|v_attr) bigint;$/.test(l) || /^\s*SELECT x\.(vat_reversed_amount INTO v_rev_before|vat_recognised_amount INTO v_attr) /.test(l)) continue;
    // an added IF … THEN block whose first statement is the vat_events INSERT (conditions: > 0, <> 0, the PKP-at-issue / redeemed tests)
    if (/^\s*IF .* THEN$/.test(l) && /INSERT INTO public\.vat_events/.test(lines[i + 1] ?? "")) {
      let j = i + 1;
      while (!/^\s*END IF;$/.test(lines[j])) j++;
      i = j;
      continue;
    }
    if (/INSERT INTO public\.vat_events/.test(l)) {
      let j = i;
      while (!/;\s*$/.test(lines[j])) j++;
      i = j;
      continue;
    }
    out.push(l);
  }
  return out.join("\n");
}

describe("T-104: migration 0121 — the six VAT seams are INSERT-only; nothing else existing changes", () => {
  it("re-creates exactly the six seams (attributes and grants kept), adds exactly the declared functions, drops nothing", () => {
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
    for (const k of ADDED) expect(after.get(k)!.acl?.includes("clinic_app=X") ?? false, k).toBe(GRANTED.includes(k));
    const file = join(import.meta.dirname, "subledgers-drift.expected.json");
    if (process.env.T104_WRITE_EXPECTED) {
      writeFileSync(file, JSON.stringify({ before: Object.fromEntries(CHANGED.map((k) => [k, sha(before.get(k)!.def)])),
        after: Object.fromEntries(CHANGED.map((k) => [k, sha(after.get(k)!.def)])) }, null, 2) + "\n");
    }
    const expected = JSON.parse(readFileSync(file, "utf8")) as { before: Record<string, string>; after: Record<string, string> };
    for (const k of CHANGED) {
      expect(sha(before.get(k)!.def), `${k} before`).toBe(expected.before[k]);
      expect(sha(after.get(k)!.def), `${k} after`).toBe(expected.after[k]);
    }
  });

  it("each new seam body minus its vat_events INSERTs is the old body line for line; each seam writes vat_events", () => {
    for (const k of CHANGED) {
      const a = after.get(k)!.def;
      expect(a, k).toMatch(/INSERT INTO public\.vat_events/);
      expect(strip(a), k).toBe(before.get(k)!.def);
    }
  });

  it("no existing policy or constraint changed or dropped", () => {
    for (const [k, v] of policiesBefore) expect(policiesAfter.get(k), k).toBe(v);
    for (const [k, v] of checksBefore) expect(checksAfter.get(k), k).toBe(v);
  });
});
