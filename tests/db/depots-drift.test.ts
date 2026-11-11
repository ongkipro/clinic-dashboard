// T-061 drift check: the depots migration adds its tables and functions and re-creates exactly the T-060 stock
// functions that become depot-aware (plan P1-2, P2-1), each keeping its 0077 signature and attributes. A database is
// migrated to exactly 0077, every public function and policy captured, then to exactly 0078 and compared: every other
// function stays byte-identical (definition, volatility, SECURITY DEFINER, search_path, grants); the re-created ones
// are exactly the declared set, each from the reviewed 0077 definition to the reviewed 0078 definition (sha-256 of
// both in depots-drift.expected.json); nothing is dropped; the added functions are the declared ones, granted to
// clinic_app only where the app calls them; no existing policy changed or dropped.
import { createHash } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/db/migrate";
import { migrationsUpTo } from "./migrations-up-to";
import { createHarness, type Harness } from "../rls/harness";

const BEFORE_TAG = "0077_stock";
const AFTER_TAG = "0078_depots";
type Fn = { def: string; volatile: string; secdef: boolean; config: string | null; acl: string | null };

let h: Harness;
let before: Map<string, Fn>;
let after: Map<string, Fn>;
let policiesBefore: Map<string, string>;
let policiesAfter: Map<string, string>;
let dirs: string[] = [];
let seeded: { tenant: string; branch: string; batch: string; vial: string; movement: string; line: string };

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
  const toBefore = migrationsUpTo(BEFORE_TAG);
  const toAfter = migrationsUpTo(AFTER_TAG);
  dirs = [toBefore, toAfter];
  let url = "";
  h = await createHarness({ migrate: async (u) => { url = u; await runMigrations(u, { folder: toBefore }); } });
  before = await capture(h.admin);
  policiesBefore = await policies(h.admin);
  // T-060 stock present before 0078 (guards off only for this fixture): a batch of 12 with one movement, an open vial
  // and a count line, so the backfill has something to move into the gudang.
  const q = (sql: string, args: unknown[] = []) => h.admin.query(sql, args).then((r) => r.rows[0]);
  const tenant = (await q(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).id as string;
  await q(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Drift Sintetis', 'emkm')`, [tenant]);
  const branch = (await q(`insert into branches (tenant_id, code, name, timezone) values ($1, 'DR', 'DR', 'Asia/Jakarta') returning id`, [tenant])).id as string;
  const acc = (await q(`insert into auth_user (name, email) values ('X', 'drift.t061@klinik-sintetis.test') returning id`)).id as string;
  const mem = (await q(`insert into memberships (tenant_id, account_id) values ($1, $2) returning id`, [tenant, acc])).id as string;
  const staff = (await q(`insert into staff (tenant_id, membership_id, display_name) values ($1, $2, 'Drift') returning id`, [tenant, mem])).id as string;
  const cat = (await q(`insert into catalog_items (tenant_id, kind, code, created_by) values ($1, 'product', 'DR-1', $2) returning id`, [tenant, staff])).id as string;
  const item = (await q(`insert into stock_items (tenant_id, catalog_item_id, unit, vial_size, opened_use_hours, created_by, updated_by) values ($1, $2, 'U', 100, 24, $3, $3) returning id`, [tenant, cat, staff])).id as string;
  const batch = (await q(`insert into stock_batches (tenant_id, branch_id, item_id, batch_no, expiry, quantity) values ($1, $2, $3, 'DR-B', current_date + 90, 0) returning id`, [tenant, branch, item])).id as string;
  const movement = (await q(`insert into stock_movements (tenant_id, branch_id, item_id, batch_id, kind, quantity, balance_after, source_kind, source_id, created_by, created_as)
                             values ($1, $2, $3, $4, 'receive', 12, 12, 'stock_receipt', gen_random_uuid(), $5, 'pharmacist') returning id`, [tenant, branch, item, batch, staff])).id as string;
  const vial = (await q(`insert into opened_vials (tenant_id, branch_id, batch_id, opened_by, opened_as, use_by, remaining) values ($1, $2, $3, $4, 'pharmacist', now() + interval '1 day', 12) returning id`, [tenant, branch, batch, staff])).id as string;
  const count = (await q(`insert into stock_counts (tenant_id, branch_id, blind, started_by, started_as) values ($1, $2, false, $3, 'pharmacist') returning id`, [tenant, branch, staff])).id as string;
  const line = (await q(`insert into stock_count_lines (tenant_id, branch_id, count_id, item_id, batch_id, system_qty) values ($1, $2, $3, $4, $5, 12) returning id`, [tenant, branch, count, item, batch])).id as string;
  seeded = { tenant, branch, batch, vial, movement, line };
  await runMigrations(url, { folder: toAfter });
  after = await capture(h.admin);
  policiesAfter = await policies(h.admin);
}, 300_000);

afterAll(async () => {
  await h?.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("T-061: the depots migration re-creates exactly the declared T-060 functions", () => {
  it("no function dropped; the changed ones are the declared set, each from its reviewed 0077 to its reviewed 0078 definition, attributes kept", () => {
    const expected = JSON.parse(readFileSync(join(import.meta.dirname, "depots-drift.expected.json"), "utf8")) as { before: Record<string, string>; after: Record<string, string> };
    const changed: string[] = [];
    for (const [k, a] of after) {
      const b = before.get(k);
      if (!b) continue;
      if (b.def !== a.def) changed.push(k);
      expect({ k, volatile: a.volatile, secdef: a.secdef, config: a.config, acl: a.acl }).toEqual({ k, volatile: b.volatile, secdef: b.secdef, config: b.config, acl: b.acl });
    }
    expect(changed.sort()).toEqual(Object.keys(expected.after).sort());
    expect(changed.sort()).toEqual([
      "opened_vials_guard()", "stock_count_apply(stock_counts,uuid,text)", "stock_count_check_unmoved(stock_counts)", "stock_count_lines_guard()",
      "stock_count_start(boolean,uuid[])", "stock_fefo(uuid,uuid,uuid,numeric,timestamp with time zone)", "stock_fit_qty(stock_batches,timestamp with time zone)",
      "stock_item_get(uuid,uuid)", "stock_move(uuid,uuid,text,numeric,text,text,uuid,uuid,text)", "stock_movements_apply()", "stock_movements_guard()",
      "stock_receive_into(uuid,uuid,text,uuid,jsonb,text,uuid)", "stock_vial_open(uuid)",
    ]);
    for (const k of changed) {
      expect(sha(before.get(k)!.def), `${k} before`).toBe(expected.before[k]);
      expect(sha(after.get(k)!.def), `${k} after`).toBe(expected.after[k]);
    }
    expect([...before.keys()].filter((k) => !after.has(k))).toEqual([]);
  });

  it("the added functions are the depot ones; only the writers, readers and the transfer read helper are granted to clinic_app", () => {
    const added = [...after.keys()].filter((k) => !before.has(k)).sort();
    const app = [
      "depot_save(uuid,jsonb)", "depot_transfer(text,jsonb)", "branch_transfer_send(text,jsonb)", "branch_transfer_receive(uuid,uuid)", "branch_transfer_cancel(uuid)",
      "stock_vial_open_in(uuid,uuid)", "stock_count_start_in(boolean,uuid[],uuid)", "depot_list(uuid)", "depot_get(uuid)", "transfer_list(uuid,text)", "transfer_get(uuid)",
      "transfer_readable(uuid,uuid,uuid)",
    ];
    const internal = [
      "batch_holdings_guard()", "branches_seed_depot()", "depot_default(uuid,uuid)", "depot_transfer_lines_guard()", "depot_transfers_guard()", "depots_guard()",
      "stock_assert_fit_depot(uuid,uuid,uuid,numeric,timestamp with time zone)", "stock_count_start_do(uuid,uuid,uuid,text,boolean,uuid[],uuid)",
      "stock_fefo_depot(uuid,uuid,uuid,numeric,timestamp with time zone)", "stock_move_depot(uuid,uuid,uuid,text,numeric,text,text,uuid,uuid,text,text)",
      "stock_vial_open_do(uuid,uuid,uuid,text,uuid,uuid)", "transfer_json(depot_transfers)", "transfer_source(uuid,text,uuid,uuid)", "transfer_take_lines(uuid,depots,jsonb)",
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

  it("the backfill puts existing stock in the branch's default gudang: holding = batch quantity; movement, vial and count line in the gudang", async () => {
    const g = (await h.admin.query(`select id, name, kind, created_by from depots where branch_id = $1 and is_default`, [seeded.branch])).rows;
    expect(g.map((x) => [x.name, x.kind, x.created_by])).toEqual([["Gudang", "gudang", null]]);
    const d = g[0].id;
    expect((await h.admin.query(`select depot_id, quantity::int q from batch_holdings where batch_id = $1`, [seeded.batch])).rows).toEqual([{ depot_id: d, q: 12 }]);
    expect((await h.admin.query(`select depot_id, depot_balance_after::int b from stock_movements where id = $1`, [seeded.movement])).rows).toEqual([{ depot_id: d, b: 12 }]);
    expect((await h.admin.query(`select depot_id from opened_vials where id = $1`, [seeded.vial])).rows).toEqual([{ depot_id: d }]);
    expect((await h.admin.query(`select depot_id from stock_count_lines where id = $1`, [seeded.line])).rows).toEqual([{ depot_id: d }]);
    // the guards are back on (ENABLE ALWAYS) after the backfill
    const t = (await h.admin.query(`select tgname, tgenabled from pg_trigger where tgname in ('stock_movements_guard','opened_vials_guard','stock_count_lines_guard') order by tgname`)).rows;
    expect(t.map((x) => x.tgenabled)).toEqual(["A", "A", "A"]);
  });

  it("no existing policy changed or dropped", () => {
    for (const [k, v] of policiesBefore) expect(policiesAfter.get(k), k).toBe(v);
  });
});
