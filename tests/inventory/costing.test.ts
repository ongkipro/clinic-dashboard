// T-063 Done-when: scenario PR-46 (10 units at Rp10,000 and 10 units received at Rp12,000; 5 units consumed →
// consumption valued at Rp11,000 per unit). Plus the plan review: costed units leave first; the last costed unit
// takes the rounding residue; intra-branch legs (issue, return, depot transfer) leave the branch value unchanged and
// the in leg equals the out leg (BILL-35); inter-branch send/receive/cancel move the same value; count surplus and
// shortfall at the average; receipts without a cost (average or uncosted); per (branch, item) Σ values = cost value,
// Σ quantities = cost quantity = Σ batch quantities after every case; guards; readers and roles; cross-tenant.
// Synthetic data on a local database (MIG-2).
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { publish } from "../../src/modules/catalog/catalog";
import { listCosts, listValues, receiveCosted } from "../../src/modules/inventory/costing/costing";
import { cancelTransfer, createDepot, receiveTransfer, sendToBranch, transferBetweenDepots } from "../../src/modules/inventory/depots/depots";
import { consumeMaterials, decideReturn, issueMaterials, proposeReturn, requestMaterials, wasteMaterials } from "../../src/modules/inventory/materials/materials";
import { getCount, receiveStock, recordCount, saveItem, startCount, submitCount } from "../../src/modules/inventory/stock";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { createHarness, type Harness, testPool } from "../rls/harness";

process.env.DEPLOY_ENV = "local";

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let n = 0;
type T = { tenantId: string; b1: string; b2: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
const TENANT_WIDE = ["owner", "finance", "admin_pusat", "purchasing", "marketing", "central_cs", "auditor"];

async function tenant(): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Biaya Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
  return { tenantId, b1: await br("C1"), b2: await br("C2") };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email) values ('X', $1) returning id`, [`cost${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Biaya ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  if (!TENANT_WIDE.includes(role)) for (const b of branches.length ? branches : [t.b1]) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, tenantId: t.tenantId, role, branch: TENANT_WIDE.includes(role) ? undefined : branches[0] ?? t.b1 };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
const key = () => crypto.randomUUID();
const day = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
const gudang = async (branch: string) => (await h.admin.query(`select id from depots where branch_id = $1 and is_default`, [branch])).rows[0].id as string;
const cost = async (branch: string, item: string) => {
  const r = (await h.admin.query(`select quantity::float q, value::float v, uncosted_quantity::float u, last_unit_cost::float c from stock_costs where branch_id = $1 and item_id = $2`, [branch, item])).rows[0];
  return r ? { q: r.q, v: r.v, u: r.u, c: r.c } : { q: 0, v: 0, u: 0, c: null };
};
const valueOf = async (movementSource: string, kind?: string) =>
  (await h.admin.query(`select m.kind, m.leg, v.value::float value, v.quantity::float q, v.uncosted_qty::float u from stock_movement_values v join stock_movements m on m.id = v.movement_id
                         where m.source_id = $1 ${kind ? "and m.kind = $2" : ""} order by m.seq`, kind ? [movementSource, kind] : [movementSource])).rows;
// Per (branch, item): Σ value rows = cost value, Σ quantities = cost quantity = Σ batch quantities; value 0 when no
// costed unit; the newest value row's afters = the cost row; Σ holdings = batch quantity (T-061).
async function invariant() {
  const bad = await h.admin.query(
    `select c.id from stock_costs c
       left join lateral (select coalesce(sum(v.value), 0) sv, coalesce(sum(v.quantity), 0) sq, coalesce(sum(v.uncosted_qty), 0) su from stock_movement_values v
                           where v.tenant_id = c.tenant_id and v.branch_id = c.branch_id and v.item_id = c.item_id) s on true
       left join lateral (select coalesce(sum(b.quantity), 0) bq from stock_batches b where b.tenant_id = c.tenant_id and b.branch_id = c.branch_id and b.item_id = c.item_id) b on true
       left join lateral (select v.quantity_after qa, v.value_after va, v.uncosted_after ua from stock_movement_values v
                           where v.tenant_id = c.tenant_id and v.branch_id = c.branch_id and v.item_id = c.item_id order by v.seq desc limit 1) l on true
      where c.value <> s.sv or c.quantity <> s.sq or c.uncosted_quantity <> s.su or c.quantity <> b.bq
         or (c.quantity, c.value, c.uncosted_quantity) is distinct from (l.qa, l.va, l.ua)
     union all
     select m.id from stock_movements m where not exists (select 1 from stock_movement_values v where v.tenant_id = m.tenant_id and v.movement_id = m.id)
     union all
     select b.id from stock_batches b
       left join lateral (select coalesce(sum(x.quantity), 0) s from batch_holdings x where x.batch_id = b.id) hs on true
      where b.quantity <> hs.s`);
  expect(bad.rows).toEqual([]);
}
async function visit(t: T, branch: string): Promise<string> {
  const pid = (await h.admin.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation, education, marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, 'Pasien Biaya', '1990-01-01', 'female', 'newborn_via_guardian', 'Fixture', 'islam',
             'Karyawan', 's1', 'kawin', $2, (select s.id from staff s where s.tenant_id = $1 limit 1), 'fo_cashier') returning id`, [t.tenantId, branch])).rows[0].id;
  return (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', (select s.id from staff s where s.tenant_id = $1 limit 1)) returning id`,
    [t.tenantId, branch, pid])).rows[0].id as string;
}

let A: T; let B: T;
let OWN: P; let FIN: P; let PU: P; let AU: P; let MGR: P; let MGR2: P; let PH: P; let PHB2: P; let NUR: P; let BFIN: P;
let G1: string; let ROOM: string;
const item = async (c: string, name: string, unit = "pcs") => {
  const cat = (await as(OWN, (db) => publish(db, { kind: "material", code: c }, { name, tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 1_000 } as never, "Barang baru"))).itemId;
  return (await as(PH, (db) => saveItem(db, key(), null, { catalogItemId: cat, unit, storage: "ruang", highValue: false, active: true }))).itemId;
};
const costed = (who: P, itemId: string, batchNo: string, quantity: string, unitCost: number, expiry = day(200)) =>
  as(who, (db) => receiveCosted(db, key(), who.branch ? null : A.b1, { itemId, batchNo, expiry, quantity, reason: "penerimaan", unitCost })).then((r) => r.batchId);

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 6 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant();
  B = await tenant();
  OWN = await person(A, "owner"); FIN = await person(A, "finance"); PU = await person(A, "purchasing"); AU = await person(A, "auditor");
  MGR = await person(A, "manager", A.b1); MGR2 = await person(A, "manager", A.b2); PH = await person(A, "pharmacist", A.b1); PHB2 = await person(A, "pharmacist", A.b2);
  NUR = await person(A, "nurse", A.b1); BFIN = await person(B, "finance");
  G1 = await gudang(A.b1);
  ROOM = (await as(PH, (db) => createDepot(db, key(), { branchId: null, name: "Ruang Tindakan", kind: "ruang" }))).depotId;
}, 300_000);
afterAll(async () => {
  await app?.end();
  await owner?.end();
  await h?.close();
});

describe("scenario PR-46: moving average", () => {
  it("10 units at Rp10,000 and 10 units received at Rp12,000; 5 units consumed → consumption valued at Rp11,000 per unit", async () => {
    const gel = await item("CST-GEL", "Gel Biaya");
    await costed(PH, gel, "G-1", "10", 10_000, day(100));
    await costed(PU, gel, "G-2", "10", 12_000, day(300));
    expect(await cost(A.b1, gel)).toEqual({ q: 20, v: 220_000, u: 0, c: 11_000 });
    const v = await visit(A, A.b1);
    const { requestId } = await as(NUR, (db) => requestMaterials(db, key(), { visitId: v, roomDepotId: ROOM, lines: [{ itemId: gel, quantity: "5" }] }));
    const { issueId } = await as(PH, (db) => issueMaterials(db, key(), requestId, { fromDepotId: G1 }));
    // the issue moves value from the gudang to the room inside the branch: unchanged
    expect((await valueOf(issueId)).map((r) => [r.leg, r.value])).toEqual([["out", -55_000], ["in", 55_000]]);
    expect(await cost(A.b1, gel)).toEqual({ q: 20, v: 220_000, u: 0, c: 11_000 });
    const { consumptionId } = await as(NUR, (db) => consumeMaterials(db, key(), requestId));
    const consumed = await valueOf(consumptionId);
    expect(consumed).toEqual([{ kind: "consume", leg: null, value: -55_000, q: -5, u: 0 }]);
    expect(consumed[0].value / consumed[0].q).toBe(11_000);
    expect(await cost(A.b1, gel)).toEqual({ q: 15, v: 165_000, u: 0, c: 11_000 });
    await invariant();
  });
});

describe("valuation rules (open point 2; review notes P2-1, P2-2)", () => {
  it("the last costed unit takes the rounding residue: everything out leaves value 0; a new receipt starts fresh", async () => {
    const pad = await item("CST-PAD", "Kasa Biaya");
    await costed(PH, pad, "P-1", "3", 10_000);
    await costed(PH, pad, "P-2", "1", 10_001); // 40,001 for 4: average 10,000.25
    const v = await visit(A, A.b1);
    const { requestId } = await as(NUR, (db) => requestMaterials(db, key(), { visitId: v, roomDepotId: ROOM, lines: [{ itemId: pad, quantity: "4" }] }));
    await as(PH, (db) => issueMaterials(db, key(), requestId, { fromDepotId: G1 }));
    // three consumed one by one through wastes (each round(value × 1 / q)), the last takes what is left
    for (let i = 0; i < 3; i++) await as(NUR, (db) => wasteMaterials(db, key(), requestId, { reason: "Kotor", lines: [{ itemId: pad, quantity: "1" }] }));
    const before = await cost(A.b1, pad);
    expect(before.q).toBe(1);
    // A fresh connection: the consumption with lines omitted (T-062's material_consume, fixed in 0080).
    await as(NUR, (db) => consumeMaterials(db, key(), requestId));
    expect(await cost(A.b1, pad)).toEqual({ q: 0, v: 0, u: 0, c: before.c });
    const wastes = (await h.admin.query(`select v.value::float x from stock_movement_values v join stock_movements m on m.id = v.movement_id where m.item_id = $1 and m.kind in ('waste','consume') order by m.seq`, [pad])).rows.map((r) => r.x);
    expect(wastes.reduce((a, b) => a + b, 0)).toBe(-40_001);
    for (const w of wastes) expect([-10_000, -10_001]).toContain(w);
    await invariant();
  });

  it("intra-branch legs leave the branch value unchanged; returns at the out leg's value; inter-branch send/receive and cancel move the same value", async () => {
    const tox = await item("CST-TOX", "Toksin Biaya", "U");
    const b = await costed(PH, tox, "T-1", "100", 2_000, day(90));
    await costed(PH, tox, "T-2", "100", 3_000, day(400)); // average 2,500
    // depot transfer inside the branch
    const { transferId } = await as(PH, (db) => transferBetweenDepots(db, key(), { fromDepotId: G1, toDepotId: ROOM, lines: [{ batchId: b, quantity: "10" }] }));
    expect((await valueOf(transferId)).map((r) => [r.leg, r.value])).toEqual([["out", -25_000], ["in", 25_000]]);
    expect(await cost(A.b1, tox)).toEqual({ q: 200, v: 500_000, u: 0, c: 2_500 });
    // a material return accepted usable: the room → gudang pair at the out leg's value
    const v = await visit(A, A.b1);
    const { requestId } = await as(NUR, (db) => requestMaterials(db, key(), { visitId: v, roomDepotId: ROOM, lines: [{ itemId: tox, quantity: "20" }] }));
    await as(PH, (db) => issueMaterials(db, key(), requestId, { fromDepotId: G1 }));
    await as(NUR, (db) => consumeMaterials(db, key(), requestId, [{ itemId: tox, quantity: "0" }]));
    const { returnId } = await as(NUR, (db) => proposeReturn(db, key(), requestId, { condition: "unopened", lines: [{ itemId: tox, quantity: "20" }] }));
    await as(PH, (db) => decideReturn(db, key(), returnId, "usable", G1));
    expect((await valueOf(returnId)).map((r) => [r.leg, r.value])).toEqual([["out", -50_000], ["in", 50_000]]);
    expect(await cost(A.b1, tox)).toEqual({ q: 200, v: 500_000, u: 0, c: 2_500 });
    // inter-branch: send 40 (A −100,000), receive at B (+100,000); a cancelled send returns the same value to A
    const { transferId: t2 } = await as(PH, (db) => sendToBranch(db, key(), { fromDepotId: G1, toBranchId: A.b2, lines: [{ batchId: b, quantity: "40" }] }));
    expect(await cost(A.b1, tox)).toEqual({ q: 160, v: 400_000, u: 0, c: 2_500 });
    await as(PHB2, (db) => receiveTransfer(db, key(), t2, null));
    expect(await cost(A.b2, tox)).toEqual({ q: 40, v: 100_000, u: 0, c: 2_500 });
    const { transferId: t3 } = await as(PH, (db) => sendToBranch(db, key(), { fromDepotId: G1, toBranchId: A.b2, lines: [{ batchId: b, quantity: "8" }] }));
    expect(await cost(A.b1, tox)).toEqual({ q: 152, v: 380_000, u: 0, c: 2_500 });
    await as(PH, (db) => cancelTransfer(db, key(), t3));
    expect(await cost(A.b1, tox)).toEqual({ q: 160, v: 400_000, u: 0, c: 2_500 });
    await invariant();
  });

  it("receipts without a cost: at the last average, else uncosted (value 0); costed units leave first; counts at the average", async () => {
    const swab = await item("CST-SWB", "Swab Biaya");
    // no cost yet: uncosted
    await as(PH, (db) => receiveStock(db, key(), null, { itemId: swab, batchNo: "S-0", expiry: day(200), quantity: "5", reason: "stok_awal" }));
    expect(await cost(A.b1, swab)).toEqual({ q: 5, v: 0, u: 5, c: null });
    await costed(PH, swab, "S-1", "10", 1_000);
    expect(await cost(A.b1, swab)).toEqual({ q: 15, v: 10_000, u: 5, c: 1_000 });
    // a plain receipt now takes the last average
    await as(PH, (db) => receiveStock(db, key(), null, { itemId: swab, batchNo: "S-2", expiry: day(200), quantity: "2", reason: "penerimaan" }));
    expect(await cost(A.b1, swab)).toEqual({ q: 17, v: 12_000, u: 5, c: 1_000 });
    // a count lowering by 13: 12 costed units leave first (12,000), then 1 uncosted (0)
    const { countId } = await as(PH, (db) => startCount(db, key(), false, [swab]));
    const lines = (await as(PH, (db) => getCount(db, countId))).lines;
    // lower the largest line by as much as possible, the rest to 0, total 4
    let left = 4;
    for (const l of lines) { const c = Math.min(l.system_qty ?? 0, left); left -= c; await as(PH, (db) => recordCount(db, key(), countId, l.id, String(c))); }
    const r = await as(PH, (db) => submitCount(db, key(), countId, "Opname biaya"));
    if (r.state === "pending_approval") {
      const ap = (await h.admin.query(`select approval_id from stock_counts where id = $1`, [countId])).rows[0].approval_id;
      await as(OWN, (db) => db.query(`select approval_decide($1, true, null)`, [ap]));
    }
    expect(await cost(A.b1, swab)).toEqual({ q: 4, v: 0, u: 4, c: 1_000 });
    // a count surplus of 3: at the last average
    const { countId: c2 } = await as(PH, (db) => startCount(db, key(), false, [swab]));
    const l2 = (await as(PH, (db) => getCount(db, c2))).lines;
    for (const [i, l] of l2.entries()) await as(PH, (db) => recordCount(db, key(), c2, l.id, String((l.system_qty ?? 0) + (i === 0 ? 3 : 0))));
    const r2 = await as(PH, (db) => submitCount(db, key(), c2, "Opname lebih"));
    if (r2.state === "pending_approval") {
      const ap = (await h.admin.query(`select approval_id from stock_counts where id = $1`, [c2])).rows[0].approval_id;
      await as(OWN, (db) => db.query(`select approval_decide($1, true, null)`, [ap]));
    }
    expect(await cost(A.b1, swab)).toEqual({ q: 7, v: 3_000, u: 4, c: 1_000 });
    await invariant();
  });

  it("an uncosted pair leaves the uncosted units where they were", async () => {
    const cap = await item("CST-CAP", "Masker Biaya");
    const b = (await as(PH, (db) => receiveStock(db, key(), null, { itemId: cap, batchNo: "C-0", expiry: day(200), quantity: "6", reason: "stok_awal" }))).batchId;
    await as(PH, (db) => transferBetweenDepots(db, key(), { fromDepotId: G1, toDepotId: ROOM, lines: [{ batchId: b, quantity: "6" }] }));
    expect(await cost(A.b1, cap)).toEqual({ q: 6, v: 0, u: 6, c: null });
    await invariant();
  });
});

describe("rounding and leg matching (mutation run 1)", () => {
  it("an outflow is valued from the value and costed units, rounded half up (not from the 4-decimal average, not truncated)", async () => {
    const dust = await item("CST-DST", "Debu Biaya");
    await costed(PH, dust, "D-1", "1", 1);
    const b = await costed(PH, dust, "D-2", "29999", 0); // value 1 over 30,000 costed units: average 0.0000 at 4 decimals
    const { transferId } = await as(PH, (db) => sendToBranch(db, key(), { fromDepotId: G1, toBranchId: A.b2, lines: [{ batchId: b, quantity: "15000" }] }));
    expect((await valueOf(transferId)).map((r) => r.value)).toEqual([-1]); // round(1 × 15000 / 30000) = round(0.5) = 1
    await invariant();
  });

  it("two batches of one item sent together: each in leg takes its own batch's out leg value", async () => {
    const pin = await item("CST-PIN", "Peniti Biaya");
    const b1 = await costed(PH, pin, "N-1", "3", 10, day(50));
    const b2 = await costed(PH, pin, "N-2", "3", 0, day(60));
    await costed(PH, pin, "N-3", "1", 1, day(70));
    // value 31 over 7: out leg 1 (3) −round(13.29) = −13, then 18 over 4: out leg 2 (3) −round(13.5) = −14 — the same
    // quantity on both legs, so only the batch tells the in legs apart.
    const { transferId } = await as(PH, (db) => sendToBranch(db, key(), { fromDepotId: G1, toBranchId: A.b2, lines: [{ batchId: b1, quantity: "3" }, { batchId: b2, quantity: "3" }] }));
    const outs = (await valueOf(transferId)).map((r) => r.value);
    expect(new Set(outs).size).toBe(2); // the two out legs carry different values
    await as(PHB2, (db) => receiveTransfer(db, key(), transferId, null));
    expect((await cost(A.b2, pin)).v).toBe(-outs.reduce((x, y) => x + y, 0));
    await invariant();
  });

  it("the valuation trigger fires in replica mode too (ENABLE ALWAYS)", async () => {
    const rep = await item("CST-REP", "Replika Biaya");
    const b = await costed(PH, rep, "R-1", "2", 50);
    await h.admin.query("begin");
    try {
      await h.admin.query("set local session_replication_role = replica");
      const m = (await h.admin.query(`select stock_move($1, $2, 'adjust', 1, 'uji', 'test', gen_random_uuid(), $3, 'pharmacist') as id`, [A.tenantId, b, PH.staffId])).rows[0].id;
      expect((await h.admin.query(`select count(*)::int n from stock_movement_values where movement_id = $1`, [m])).rows[0].n).toBe(1);
    } finally {
      await h.admin.query("rollback");
    }
  });

  it("the value and cost guards stand on their own (trigger off inside one rolled-back transaction)", async () => {
    const gd = await item("CST-GD2", "Jaga Dua Biaya");
    const b = await costed(PH, gd, "G-1", "10", 100); // 10 @ 100: value 1,000
    const depots = { from: G1, to: ROOM };
    await h.admin.query("begin");
    try {
      await h.admin.query("alter table stock_movements disable trigger stock_movements_value");
      const move = async (depot: string, kind: string, q: number, leg: string | null, src: string) =>
        (await h.admin.query(`select id, seq from stock_movements where id = $1`, [(await h.admin.query(`select stock_move_depot($1, $2, $3, $4, $5, null, 'test_pair', $6, $7, 'pharmacist', $8) as id`,
          [A.tenantId, b, depot, kind, q, src, PH.staffId, leg])).rows[0].id])).rows[0]; // a statement does not see rows its own function inserted
      const src = crypto.randomUUID();
      const older = await move(depots.from, "adjust", -1, null, crypto.randomUUID()); // 9 left, not valued
      const outLeg = await move(depots.from, "transfer_out", -2, "out", src);
      const val = (m: { id: string; seq: string }, q: number, v: number, qa: number, va: number) => code(h.admin.query(
        `insert into stock_movement_values (tenant_id, branch_id, item_id, movement_id, seq, quantity, value, uncosted_qty, unit_cost, quantity_after, value_after, uncosted_after)
         values ($1, $2, $3, $4, $5, $6, $7, 0, 100, $8, $9, 0)`, [A.tenantId, A.b1, gd, m.id, m.seq, q, v, qa, va]));
      // a value row for a movement that is not the newest of its item: refused
      await h.admin.query("savepoint a");
      expect(await val(older, -1, -100, 9, 900)).toBe("raw:42501");
      await h.admin.query("rollback to savepoint a");
      // the newest, not continuing the cost row (the cost row is 10 / 1,000; the movement takes 2): refused
      expect(await val(outLeg, -2, -200, 9, 800)).toBe("raw:42501");
    } finally {
      await h.admin.query("rollback");
    }
    // A clean chain: out leg then in leg, valued by hand, the in leg with a wrong value refused, the right one accepted;
    // a cost row with a wrong last unit cost refused.
    await h.admin.query("begin");
    try {
      await h.admin.query("alter table stock_movements disable trigger stock_movements_value");
      const src = crypto.randomUUID();
      const mv = async (depot: string, kind: string, q: number, leg: string) =>
        (await h.admin.query(`select id, seq from stock_movements where id = $1`, [(await h.admin.query(`select stock_move_depot($1, $2, $3, $4, $5, null, 'test_pair', $6, $7, 'pharmacist', $8) as id`,
          [A.tenantId, b, depot, kind, q, src, PH.staffId, leg])).rows[0].id])).rows[0]; // a statement does not see rows its own function inserted
      const ins = (m: { id: string; seq: string }, q: number, v: number, qa: number, va: number) => h.admin.query(
        `insert into stock_movement_values (tenant_id, branch_id, item_id, movement_id, seq, quantity, value, uncosted_qty, unit_cost, quantity_after, value_after, uncosted_after)
         values ($1, $2, $3, $4, $5, $6, $7, 0, 100, $8, $9, 0)`, [A.tenantId, A.b1, gd, m.id, m.seq, q, v, qa, va]);
      const setCost = (seq: string, q: number, v: number, last: number) => h.admin.query(
        `update stock_costs set quantity = $3, value = $4, uncosted_quantity = 0, last_seq = $5, last_unit_cost = $6 where branch_id = $1 and item_id = $2`, [A.b1, gd, q, v, seq, last]);
      const o = await mv(depots.from, "transfer_out", -2, "out");
      await ins(o, -2, -200, 8, 800);
      await h.admin.query("savepoint s0");
      expect(await code(setCost(o.seq, 8, 800, 99))).toBe("raw:42501"); // wrong last unit cost
      await h.admin.query("rollback to savepoint s0");
      await setCost(o.seq, 8, 800, 100);
      await h.admin.query("savepoint s1");
      expect(await code(setCost(o.seq, 8, 800, 100))).toBe("raw:42501"); // the same afters again: refused
      await h.admin.query("rollback to savepoint s1");
      const i = await mv(depots.to, "transfer_in", 2, "in");
      await h.admin.query("savepoint s2");
      expect(await code(ins(i, 2, 250, 10, 1_050))).toBe("raw:42501"); // an in leg with another value than its out leg
      await h.admin.query("rollback to savepoint s2");
      expect(await code(ins(i, 2, 200, 10, 1_000))).toBe("ok");
    } finally {
      await h.admin.query("rollback");
    }
    await invariant();
  });
});

describe("T-062 material_consume on a fresh connection (fixed in 0080)", () => {
  it("the first consumption on a new connection with lines omitted works (0079 failed: record v_x not assigned)", async () => {
    const it3 = await item("CST-FR", "Segar Biaya");
    await costed(PH, it3, "F-1", "5", 900);
    const v = await visit(A, A.b1);
    const { requestId } = await as(NUR, (db) => requestMaterials(db, key(), { visitId: v, roomDepotId: ROOM, lines: [{ itemId: it3, quantity: "2" }] }));
    await as(PH, (db) => issueMaterials(db, key(), requestId, { fromDepotId: G1 }));
    const fresh = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 1 });
    try {
      const ctx = await resolveContext(fresh, NUR.acc, { tenantId: NUR.tenantId, actingRole: NUR.role, activeBranchId: NUR.branch });
      await withTenantContext(fresh, ctx, (db) => consumeMaterials(db, key(), requestId));
    } finally {
      await fresh.end();
    }
    expect(await cost(A.b1, it3)).toEqual({ q: 3, v: 2_700, u: 0, c: 900 });
    await invariant();
  });
});

describe("costed receipt, guards, readers (open points 3, 6; P2-1, P3)", () => {
  it("unit cost is an integer 0..1e9 rupiah; roles; replay; the receipt's value row carries the cost", async () => {
    const it2 = await item("CST-IN", "Barang Biaya");
    const k = key();
    const p = { itemId: it2, batchNo: "I-1", expiry: day(200), quantity: "4", reason: "penerimaan" as const, unitCost: 2_500 };
    const { batchId } = await as(PH, (db) => receiveCosted(db, k, null, p));
    expect((await as(PH, (db) => receiveCosted(db, k, null, p))).batchId).toBe(batchId);
    expect(await cost(A.b1, it2)).toEqual({ q: 4, v: 10_000, u: 0, c: 2_500 });
    for (const bad of [1.5, -1, 1_000_000_001]) expect(await code(as(PH, (db) => receiveCosted(db, key(), null, { ...p, unitCost: bad })))).toBe("ERR_INVALID_INPUT");
    // a refused receipt keeps nothing (the key is not spent)
    const k2 = key();
    expect(await code(as(PH, (db) => receiveCosted(db, k2, null, { ...p, unitCost: 2.5 })))).toBe("ERR_INVALID_INPUT");
    expect((await h.admin.query(`select count(*)::int n from idempotency_records where key = $1`, [k2])).rows[0].n).toBe(0);
    expect(await code(as(PH, (db) => db.query(`select stock_receive_costed(null, $1::jsonb)`, [JSON.stringify({ item_id: it2, batch_no: "I-2", expiry: day(200), quantity: "1", reason: "penerimaan", unit_cost: "5" })])))).toBe("raw:22023");
    expect(await code(as(PH, (db) => db.query(`select stock_receive_costed(null, $1::jsonb)`, [JSON.stringify({ item_id: it2, batch_no: "I-2", expiry: day(200), quantity: "1", reason: "penerimaan", unit_cost: 2.5 })])))).toBe("raw:22023");
    for (const who of [NUR, MGR, FIN, OWN]) expect(await code(as(who, (db) => receiveCosted(db, key(), A.b1, p)))).toBe("ERR_FORBIDDEN");
    expect(await code(as(PH, (db) => receiveCosted(db, key(), null, { ...p, itemId: crypto.randomUUID() })))).toBe("ERR_NOT_FOUND");
    // the free-quantity zero cost is a cost (valued 0, not uncosted)
    await costed(PH, it2, "I-3", "4", 0);
    expect(await cost(A.b1, it2)).toEqual({ q: 8, v: 10_000, u: 0, c: 1_250 });
    await invariant();
  });

  it("guards: values insert-only and only for the newest movement; cost rows move only by their newest value; receipt costs insert-only; truncate refused", async () => {
    const g = await item("CST-GRD", "Jaga Biaya");
    await costed(PH, g, "J-1", "2", 100);
    const c = (await h.admin.query(`select * from stock_costs where branch_id = $1 and item_id = $2`, [A.b1, g])).rows[0];
    const raw = (sql: string, args: unknown[] = []) => code(h.admin.query(sql, args));
    expect(await raw(`update stock_costs set value = value + 1 where id = $1`, [c.id])).toBe("raw:42501");
    expect(await raw(`update stock_costs set last_unit_cost = 1 where id = $1`, [c.id])).toBe("raw:42501");
    expect(await raw(`update stock_costs set quantity = quantity where id = $1`, [c.id])).toBe("raw:42501"); // the same afters again: last_seq does not advance
    expect(await raw(`delete from stock_costs where id = $1`, [c.id])).toBe("raw:42501");
    expect(await raw(`insert into stock_costs (tenant_id, branch_id, item_id, quantity) values ($1, $2, $3, 5)`, [A.tenantId, A.b2, g])).toBe("raw:42501");
    const mv = (await h.admin.query(`select v.* from stock_movement_values v where v.branch_id = $1 and v.item_id = $2`, [A.b1, g])).rows[0];
    expect(await raw(`update stock_movement_values set value = 0 where id = $1`, [mv.id])).toBe("raw:42501");
    expect(await raw(`delete from stock_movement_values where id = $1`, [mv.id])).toBe("raw:42501");
    expect(await raw(`update stock_receipt_costs set unit_cost = 1 where item_id = $1`, [g])).toBe("raw:42501");
    expect(await raw(`truncate stock_costs`)).toMatch(/^raw:/);
    // replica mode does not switch the guards off
    await h.admin.query("begin");
    try {
      await h.admin.query("set local session_replication_role = replica");
      expect(await code(h.admin.query(`update stock_costs set value = value + 1 where id = $1`, [c.id]))).toBe("raw:42501");
    } finally {
      await h.admin.query("rollback");
    }
    // NaN is refused by the bounds
    expect(await raw(`insert into stock_receipt_costs (tenant_id, branch_id, item_id, source_kind, source_id, unit_cost, created_by, created_as)
                      values ($1, $2, $3, 'test', gen_random_uuid(), -1, $4, 'pharmacist')`, [A.tenantId, A.b1, g, PH.staffId])).toBe("raw:23514");
    await invariant();
  });

  it("readers: money roles tenant-wide, manager at the own branch; pharmacist and room roles not; other tenant not; no reason or source in values", async () => {
    const r = await item("CST-RD", "Baca Biaya");
    await costed(PH, r, "R-1", "3", 7_000);
    for (const who of [OWN, FIN, PU, AU]) expect((await as(who, (db) => listCosts(db, A.b1))).items.find((x) => x.item_id === r)).toMatchObject({ quantity: 3, value: 21_000, average: 7_000 });
    expect((await as(MGR, (db) => listCosts(db, null))).items.some((x) => x.item_id === r)).toBe(true);
    expect(await code(as(MGR2, (db) => listCosts(db, A.b1)))).toBe("ERR_NOT_FOUND");
    for (const who of [PH, NUR]) expect(await code(as(who, (db) => listCosts(db, A.b1)))).toBe("ERR_FORBIDDEN");
    expect(await code(as(BFIN, (db) => listCosts(db, A.b1)))).toBe("ERR_NOT_FOUND");
    const vals = await as(FIN, (db) => listValues(db, r, A.b1, 10));
    expect(vals.map((x) => [x.kind, x.value])).toEqual([["receive", 21_000]]);
    expect(Object.keys(vals[0])).not.toContain("reason");
    expect(Object.keys(vals[0])).not.toContain("source_id");
    // RLS on the tables
    expect((await as(FIN, (db) => db.query(`select id from stock_costs where item_id = $1`, [r]))).rows.length).toBe(1);
    expect((await as(PH, (db) => db.query(`select id from stock_costs where item_id = $1`, [r]))).rows.length).toBe(0);
    expect((await as(MGR2, (db) => db.query(`select id from stock_movement_values where item_id = $1`, [r]))).rows.length).toBe(0);
    expect((await as(BFIN, (db) => db.query(`select id from stock_receipt_costs where item_id = $1`, [r]))).rows.length).toBe(0);
    expect(await code(as(FIN, (db) => listValues(db, r, A.b1, 0)))).toBe("ERR_INVALID_INPUT");
  });
});
