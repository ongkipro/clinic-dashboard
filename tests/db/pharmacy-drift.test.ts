// T-065 drift check (plan P1-2): the pharmacy migration (0082) adds its tables, triggers and functions and re-creates
// exactly three existing functions — 0077's stock_unfit_reason (temperature_excursion is unfit), stock_batches_guard
// (the new state; a hold or release only with its history row) and stock_batch_hold (a reason for every transition,
// kept in stock_batch_holds) — keeping their signatures and attributes. A database is migrated to exactly 0081, every
// public function and policy captured, then to exactly 0082 and compared: every other function stays byte-identical;
// the added functions are the declared ones, granted to clinic_app only where the app calls them; no existing policy
// changed or dropped; the widened batch state check is the only changed constraint on stock_batches.
import { readFileSync, rmSync } from "node:fs";
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
  const toBefore = migrationsUpTo("0081_treatment");
  const toAfter = migrationsUpTo("0082_pharmacy");
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

const CHANGED = ["stock_batch_hold(uuid,text,text)", "stock_batches_guard()", "stock_unfit_reason(stock_batches,timestamp with time zone)"];

describe("T-065: the pharmacy migration re-creates only the three batch-state functions", () => {
  it("no function dropped; the changed ones are exactly the three, from their reviewed 0077 to their reviewed 0082 definitions, attributes kept", () => {
    const expected = JSON.parse(readFileSync(join(import.meta.dirname, "pharmacy-drift.expected.json"), "utf8")) as { before: Record<string, string>; after: Record<string, string> };
    const changed: string[] = [];
    for (const [k, a] of after) {
      const b = before.get(k);
      if (!b) continue;
      if (b.def !== a.def) changed.push(k);
      expect({ k, volatile: a.volatile, secdef: a.secdef, config: a.config, acl: a.acl }).toEqual({ k, volatile: b.volatile, secdef: b.secdef, config: b.config, acl: b.acl });
    }
    expect(changed.sort()).toEqual(CHANGED);
    for (const k of CHANGED) {
      expect(sha(before.get(k)!.def), k).toBe(expected.before[k]);
      expect(sha(after.get(k)!.def), k).toBe(expected.after[k]);
    }
    expect(after.get("stock_unfit_reason(stock_batches,timestamp with time zone)")!.def).toContain("temperature_excursion");
    expect(after.get("stock_batches_guard()")!.def).toContain("stock_batch_holds");
    expect([...before.keys()].filter((x) => !after.has(x))).toEqual([]);
  });

  it("the added functions are the pharmacy ones; only the writers, readers and read predicates are granted to clinic_app", () => {
    const added = [...after.keys()].filter((k) => !before.has(k)).sort();
    const app = [
      "selection_confirm(text,uuid,jsonb)", "recipe_map_set(uuid,integer,jsonb)", "special_item_add(uuid,text)", "selection_prepare_materials(text,uuid,uuid)",
      "prescription_create(text,uuid,jsonb)", "prescription_item_add(text,uuid,jsonb)", "prescription_item_remove(uuid,uuid)", "prescription_sign(uuid)",
      "dispense_prepare(text,uuid,uuid)", "dispense_hand_over(text,uuid,jsonb)", "dispense_cancel(uuid,text)", "label_print(uuid)",
      "pharmacy_prep_list()", "pharmacy_handover_list()", "pharmacy_dispensing_get(uuid)", "prescription_get(uuid)", "pharmacy_recall_trace(uuid)",
      "pharmacy_readable(uuid,uuid)", "selection_readable(uuid,uuid)", "pharmacy_config_readable(uuid)",
    ];
    const internal = [
      "pharmacy_actor(text[])", "pharmacy_visit_locked(uuid,uuid,uuid)", "pharmacy_special(uuid,uuid)", "pharmacy_recipe_lines(uuid,uuid,numeric)",
      "pharmacy_room_depot(uuid,uuid,uuid)", "pharmacy_fefo_hint(uuid,uuid,uuid,numeric)", "pharmacy_dispense_depot(uuid,uuid,uuid,numeric)",
      "pharmacy_visit_steps(uuid,uuid)", "pharmacy_rx_blocker(dispensings,timestamp with time zone)", "pharmacy_rows_insert_only()", "selection_items_guard()",
      "pharmacy_recipe_items_guard()", "prescriptions_guard()", "prescription_items_guard()", "dispensings_guard()", "labels_guard()",
      "stock_items_pharmacy_guard()", "material_requests_visit_steps()", "prescription_draft_locked(uuid,uuid,uuid,uuid)", "dispensing_locked(uuid,uuid,uuid)",
      "dispensing_blocker(dispensings)", "pharmacy_reader(text[])", "pharmacy_patient_json(uuid,uuid)", "pharmacy_item_name(uuid,uuid)",
      "pharmacy_dispensing_row(dispensings)",
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

  it("no existing policy changed or dropped; the batch state check is the only changed constraint", () => {
    for (const [k, v] of policiesBefore) expect(policiesAfter.get(k), k).toBe(v);
    const changed = [...checksBefore].filter(([k, v]) => checksAfter.get(k) !== v).map(([k]) => k);
    expect(changed).toEqual(["stock_batches.stock_batches_state_check"]);
    expect(checksAfter.get("stock_batches.stock_batches_state_check")).toContain("temperature_excursion");
  });

  it("the new triggers are enabled always", async () => {
    const t = (await h.admin.query(`select tgname, tgenabled from pg_trigger where tgname in ('selections_guard','selection_items_guard','stock_batch_holds_guard',
      'pharmacy_special_items_guard','pharmacy_recipe_items_guard','prescriptions_guard','prescription_items_guard','dispensings_guard','dispensing_lines_guard',
      'labels_guard','stock_items_pharmacy_guard','material_requests_visit_steps') order by tgname`)).rows;
    expect(t).toHaveLength(12);
    expect(t.every((x) => x.tgenabled === "A")).toBe(true);
  });
});
