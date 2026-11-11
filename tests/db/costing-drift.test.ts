// T-063 drift check: the costing migration (0080) adds its tables, trigger and functions and re-creates exactly one
// existing function — T-062's material_consume, fixed (it read a field of an unassigned record in a CASE, failing the
// first lines-omitted consumption on a connection) — keeping its signature and attributes. A database is migrated to
// exactly 0079, every public function and policy captured, then to exactly 0080 and compared: every other function
// stays byte-identical; the added functions are the declared ones, granted to clinic_app only where the app calls
// them; no existing policy changed or dropped; existing movements get value rows (uncosted) and their cost row.
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
let dirs: string[] = [];
let seeded: { branch: string; item: string; movement: string };

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
const sha = (s: string) => createHash("sha256").update(s.trimEnd()).digest("hex");

beforeAll(async () => {
  const toBefore = migrationsUpTo("0079_materials");
  const toAfter = migrationsUpTo("0080_costing");
  dirs = [toBefore, toAfter];
  let url = "";
  h = await createHarness({ migrate: async (u) => { url = u; await runMigrations(u, { folder: toBefore }); } });
  before = await capture(h.admin);
  policiesBefore = await policies(h.admin);
  // Stock present before 0080: two receipts of one item (5 then 7 units), so the backfill values them (uncosted).
  const q = (sql: string, args: unknown[] = []) => h.admin.query(sql, args).then((r) => r.rows[0]);
  const tenant = (await q(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).id as string;
  await q(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Drift Biaya', 'emkm')`, [tenant]);
  const branch = (await q(`insert into branches (tenant_id, code, name, timezone) values ($1, 'DC', 'DC', 'Asia/Jakarta') returning id`, [tenant])).id as string;
  const acc = (await q(`insert into auth_user (name, email) values ('X', 'drift.t063@klinik-sintetis.test') returning id`)).id as string;
  const mem = (await q(`insert into memberships (tenant_id, account_id) values ($1, $2) returning id`, [tenant, acc])).id as string;
  const staff = (await q(`insert into staff (tenant_id, membership_id, display_name) values ($1, $2, 'Drift') returning id`, [tenant, mem])).id as string;
  const cat = (await q(`insert into catalog_items (tenant_id, kind, code, created_by) values ($1, 'material', 'DC-1', $2) returning id`, [tenant, staff])).id as string;
  const item = (await q(`insert into stock_items (tenant_id, catalog_item_id, unit, created_by, updated_by) values ($1, $2, 'pcs', $3, $3) returning id`, [tenant, cat, staff])).id as string;
  const batch = (await q(`insert into stock_batches (tenant_id, branch_id, item_id, batch_no, expiry, quantity) values ($1, $2, $3, 'DC-B', current_date + 90, 0) returning id`, [tenant, branch, item])).id as string;
  const mv = async (qty: number) => (await q(`select stock_move($1, $2, 'receive', $3, 'stok_awal', 'stock_receipt', gen_random_uuid(), $4, 'pharmacist') as id`, [tenant, batch, qty, staff])).id as string;
  await mv(5);
  const movement = await mv(7);
  seeded = { branch, item, movement };
  await runMigrations(url, { folder: toAfter });
  after = await capture(h.admin);
  policiesAfter = await policies(h.admin);
}, 300_000);

afterAll(async () => {
  await h?.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("T-063: the costing migration re-creates only the fixed material_consume", () => {
  it("no function dropped; the only changed one is material_consume, from its reviewed 0079 to its reviewed 0080 definition, attributes kept", () => {
    const expected = JSON.parse(readFileSync(join(import.meta.dirname, "costing-drift.expected.json"), "utf8")) as { before: Record<string, string>; after: Record<string, string> };
    const changed: string[] = [];
    for (const [k, a] of after) {
      const b = before.get(k);
      if (!b) continue;
      if (b.def !== a.def) changed.push(k);
      expect({ k, volatile: a.volatile, secdef: a.secdef, config: a.config, acl: a.acl }).toEqual({ k, volatile: b.volatile, secdef: b.secdef, config: b.config, acl: b.acl });
    }
    expect(changed).toEqual(["material_consume(text,uuid,jsonb)"]);
    const k = changed[0];
    expect(sha(before.get(k)!.def)).toBe(expected.before[k]);
    expect(sha(after.get(k)!.def)).toBe(expected.after[k]);
    // the fix changes only the assignment of the line's batch and quantity
    const strip = (s: string) => s.replace(/\n\s*--[^\n]*/g, "").replace(/\s+/g, " ");
    expect(strip(after.get(k)!.def)).not.toContain("CASE WHEN v_found THEN v_x.batch_id");
    expect([...before.keys()].filter((x) => !after.has(x))).toEqual([]);
  });

  it("the added functions are the costing ones; only the receipt writer, readers and the read helper are granted to clinic_app", () => {
    const added = [...after.keys()].filter((k) => !before.has(k)).sort();
    const app = ["stock_receive_costed(uuid,jsonb)", "stock_cost_list(uuid)", "stock_movement_value_list(uuid,uuid,integer)", "stock_cost_readable(uuid,uuid)"];
    const internal = ["stock_movements_value()", "stock_movement_values_guard()", "stock_costs_guard()", "stock_receipt_costs_guard()", "stock_cost_reader(uuid)"];
    expect(added).toEqual([...app, ...internal].sort());
    for (const k of added) {
      const acl = after.get(k)!.acl ?? "";
      expect(after.get(k)!.acl, k).not.toBeNull();
      if (app.includes(k)) expect(acl, k).toMatch(/clinic_app=X\//);
      else expect(acl, k).not.toMatch(/clinic_(app|vendor|executor|operator)=X\//);
      expect(acl, k).not.toMatch(/[{,]=X\//);
    }
  });

  it("the backfill values existing movements uncosted with running afters and opens the cost row at the last", async () => {
    const v = (await h.admin.query(`select quantity::int q, value::int v, uncosted_qty::int u, quantity_after::int qa, uncosted_after::int ua from stock_movement_values
                                     where branch_id = $1 and item_id = $2 order by seq`, [seeded.branch, seeded.item])).rows;
    expect(v).toEqual([{ q: 5, v: 0, u: 5, qa: 5, ua: 5 }, { q: 7, v: 0, u: 7, qa: 12, ua: 12 }]);
    expect((await h.admin.query(`select quantity::int q, value::int v, uncosted_quantity::int u, last_unit_cost, last_seq = (select seq from stock_movements where id = $3) s
                                  from stock_costs where branch_id = $1 and item_id = $2`, [seeded.branch, seeded.item, seeded.movement])).rows)
      .toEqual([{ q: 12, v: 0, u: 12, last_unit_cost: null, s: true }]);
    const t = (await h.admin.query(`select tgname, tgenabled from pg_trigger where tgname in ('stock_movements_value','stock_costs_guard','stock_movement_values_guard','stock_receipt_costs_guard') order by tgname`)).rows;
    expect(t.map((x) => x.tgenabled)).toEqual(["A", "A", "A", "A"]);
  });

  it("no existing policy changed or dropped", () => {
    for (const [k, v] of policiesBefore) expect(policiesAfter.get(k), k).toBe(v);
  });
});
