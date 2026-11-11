// T-061 Done-when: scenarios PR-89 (depot transfer: gudang 6, room depot 4, one transfer record and two linked
// movements; concurrent: two transfers of 4 from 5 at once, one refused for insufficient stock, replaying the
// successful key changes nothing) and the transfer half of PR-17 (10 at branch A, 0 at B; 4 transferred and received
// → A 6, B 4 with the same batch numbers). Plus the plan review: Σ holdings = batch quantity after every case,
// backfill and the seeded gudang, in transit and cancel, fit sealed stock only (no open vial remainder, no unfit
// batch), lines validated, vials and counts per depot, guards, roles, readers, events content-free, cross-tenant.
// Synthetic data on a local database (MIG-2).
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { publish } from "../../src/modules/catalog/catalog";
import {
  cancelTransfer, createDepot, getDepot, getTransfer, listDepots, listTransfers, openVialIn, receiveTransfer, sendToBranch, startDepotCount,
  transferBetweenDepots, updateDepot,
} from "../../src/modules/inventory/depots/depots";
import { getCount, holdBatch, receiveStock, recordCount, saveItem, submitCount } from "../../src/modules/inventory/stock";
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

async function tenant(state = "live"): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ($1) returning id`, [state])).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Depot Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
  return { tenantId, b1: await br("D1"), b2: await br("D2") };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email) values ('X', $1) returning id`, [`dep${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Depot ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  if (!TENANT_WIDE.includes(role)) for (const b of branches.length ? branches : [t.b1]) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, tenantId: t.tenantId, role, branch: TENANT_WIDE.includes(role) ? undefined : branches[0] ?? t.b1 };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
const reason = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e as { reason?: string }).reason ?? (e as Error).message);
const key = () => crypto.randomUUID();
const day = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
const held = async (depot: string, batch: string) =>
  Number((await h.admin.query(`select coalesce((select quantity from batch_holdings where depot_id = $1 and batch_id = $2), 0) as q`, [depot, batch])).rows[0].q);
const batchQty = async (batch: string) => Number((await h.admin.query(`select quantity from stock_batches where id = $1`, [batch])).rows[0].quantity);
const gudang = async (branch: string) => (await h.admin.query(`select id from depots where branch_id = $1 and is_default`, [branch])).rows[0].id as string;
// Σ holdings of every batch = its quantity; every holding = the newest movement's depot balance (the invariant).
async function invariant() {
  const bad = await h.admin.query(
    `select b.id from stock_batches b
       left join lateral (select coalesce(sum(x.quantity), 0) s from batch_holdings x where x.batch_id = b.id) hs on true
      where b.quantity <> hs.s
     union all
     select hh.id from batch_holdings hh
       left join lateral (select m.depot_balance_after d from stock_movements m where m.batch_id = hh.batch_id and m.depot_id = hh.depot_id order by m.seq desc limit 1) m on true
      where hh.quantity <> coalesce(m.d, 0)`);
  expect(bad.rows).toEqual([]);
}

let A: T; let B: T;
let OWN: P; let AP: P; let PU: P; let AU: P; let MGR: P; let PH: P; let PH2: P; let PHB2: P; let DOC: P; let BPH: P;
let vial: string; let gauze: string;
let G1: string; let G2: string; let ROOM: string;

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 6 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant();
  B = await tenant();
  OWN = await person(A, "owner"); AP = await person(A, "admin_pusat"); PU = await person(A, "purchasing"); AU = await person(A, "auditor");
  MGR = await person(A, "manager", A.b1); PH = await person(A, "pharmacist", A.b1); PH2 = await person(A, "pharmacist", A.b1); PHB2 = await person(A, "pharmacist", A.b2);
  DOC = await person(A, "doctor", A.b1); BPH = await person(B, "pharmacist", B.b1);
  const pub = async (kind: "material" | "product", c: string, name: string) =>
    (await as(OWN, (db) => publish(db, { kind, code: c }, { name, tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 1_000 } as never, "Barang baru"))).itemId;
  const toxCat = await pub("product", "DEP-TOX", "Toksin Depot");
  const kasCat = await pub("material", "DEP-KAS", "Kasa Depot");
  vial = (await as(PH, (db) => saveItem(db, key(), null, { catalogItemId: toxCat, unit: "U", vialSize: "100", openedUseHours: 24, storage: "dingin", highValue: true, active: true }))).itemId;
  gauze = (await as(PU, (db) => saveItem(db, key(), null, { catalogItemId: kasCat, unit: "pcs", storage: "ruang", highValue: false, active: true }))).itemId;
  G1 = await gudang(A.b1);
  G2 = await gudang(A.b2);
  ROOM = (await as(PH, (db) => createDepot(db, key(), { branchId: null, name: "Ruang Tindakan 1", kind: "ruang" }))).depotId;
}, 300_000);
afterAll(async () => {
  await app?.end();
  await owner?.end();
  await h?.close();
});

describe("depots (open points 2, 8)", () => {
  it("every branch has one active default gudang, seeded with the branch; new depots by pharmacist, purchasing, admin pusat; never deleted", async () => {
    expect((await h.admin.query(`select count(*)::int n from depots where tenant_id = $1 and is_default`, [A.tenantId])).rows[0].n).toBe(2);
    expect((await h.admin.query(`select name, kind, created_by from depots where id = $1`, [G1])).rows[0]).toEqual({ name: "Gudang", kind: "gudang", created_by: null });
    const ap = (await as(AP, (db) => createDepot(db, key(), { branchId: A.b2, name: "Apotek", kind: "apotek" }))).depotId;
    expect(await code(as(PH, (db) => createDepot(db, key(), { branchId: A.b2, name: "Lain", kind: "ruang" })))).toBe("ERR_FORBIDDEN");
    expect(await code(as(PH, (db) => createDepot(db, key(), { branchId: null, name: "Ruang Tindakan 1", kind: "ruang" })))).toBe("ERR_INVALID_INPUT");
    expect(await code(as(PU, (db) => createDepot(db, key(), { branchId: null, name: "Tanpa Cabang", kind: "ruang" })))).toBe("ERR_INVALID_INPUT");
    for (const p of [MGR, OWN, AU, DOC]) expect(await code(as(p, (db) => createDepot(db, key(), { branchId: A.b1, name: "Coba", kind: "ruang" })))).toBe("ERR_FORBIDDEN");
    expect(await code(as(PU, (db) => updateDepot(db, key(), G1, { name: "Gudang Utama", active: false })))).toBe("ERR_INVALID_INPUT"); // default stays active
    await as(PU, (db) => updateDepot(db, key(), ap, { name: "Apotek Depan", active: false }));
    expect(await code(as(PHB2, (db) => updateDepot(db, key(), ROOM, { name: "X", active: true })))).toBe("ERR_NOT_FOUND");
    expect(await code(h.admin.query(`delete from depots where id = $1`, [ap]))).toBe("raw:42501");
    expect(await code(h.admin.query(`update depots set is_default = false where id = $1`, [G1]))).toBe("raw:42501");
    const list = await as(PH, (db) => listDepots(db, null));
    expect(list.map((d) => [d.name, d.is_default])).toEqual([["Gudang", true], ["Ruang Tindakan 1", false]]);
  });

  it("a ruang depot may name a treatment room of the same branch only", async () => {
    const room = (await h.admin.query(`insert into rooms (tenant_id, branch_id, name, kind) values ($1, $2, 'Ruang 2', 'treatment') returning id`, [A.tenantId, A.b1])).rows[0].id;
    const cons = (await h.admin.query(`insert into rooms (tenant_id, branch_id, name, kind) values ($1, $2, 'Konsultasi', 'consultation') returning id`, [A.tenantId, A.b1])).rows[0].id;
    const other = (await h.admin.query(`insert into rooms (tenant_id, branch_id, name, kind) values ($1, $2, 'Ruang B2', 'treatment') returning id`, [A.tenantId, A.b2])).rows[0].id;
    expect(await code(as(PH, (db) => createDepot(db, key(), { branchId: null, name: "Ruang Dua", kind: "ruang", roomId: room })))).toBe("ok");
    expect(await code(as(PH, (db) => createDepot(db, key(), { branchId: null, name: "Ruang Kons", kind: "ruang", roomId: cons })))).toBe("ERR_INVALID_INPUT");
    expect(await code(as(PH, (db) => createDepot(db, key(), { branchId: null, name: "Ruang Lain", kind: "ruang", roomId: other })))).toBe("ERR_INVALID_INPUT");
    expect(await code(as(PH, (db) => createDepot(db, key(), { branchId: null, name: "Gudang Ruang", kind: "gudang", roomId: room })))).toBe("ERR_INVALID_INPUT");
  });
});

describe("scenario PR-89: depot transfer", () => {
  it("10 vials in the gudang; 4 to Ruang Tindakan 1 → gudang 6, room 4, one transfer record and two linked movements", async () => {
    const b = (await as(PH, (db) => receiveStock(db, key(), null, { itemId: vial, batchNo: "V-89", expiry: day(200), quantity: "10", reason: "stok_awal" }))).batchId;
    expect([await held(G1, b), await batchQty(b)]).toEqual([10, 10]);
    const k = key();
    const { transferId } = await as(PH, (db) => transferBetweenDepots(db, k, { fromDepotId: G1, toDepotId: ROOM, lines: [{ batchId: b, quantity: "4" }] }));
    expect([await held(G1, b), await held(ROOM, b), await batchQty(b)]).toEqual([6, 4, 10]);
    expect((await h.admin.query(`select count(*)::int n from depot_transfers where id = $1`, [transferId])).rows[0].n).toBe(1);
    const legs = (await h.admin.query(`select kind, leg, depot_id, quantity::int q, source_kind, source_id from stock_movements where source_id = $1 order by seq`, [transferId])).rows;
    expect(legs).toEqual([
      { kind: "transfer_out", leg: "out", depot_id: G1, q: -4, source_kind: "depot_transfer", source_id: transferId },
      { kind: "transfer_in", leg: "in", depot_id: ROOM, q: 4, source_kind: "depot_transfer", source_id: transferId },
    ]);
    const t = await as(PU, (db) => getTransfer(db, transferId));
    expect([t.kind, t.state, t.from_depot, t.to_depot, t.lines.map((l) => [l.batch_no, l.quantity])]).toEqual(["intra", "posted", "Gudang", "Ruang Tindakan 1", [["V-89", 4]]]);
    await invariant();
  });
});

describe("scenario PR-89: concurrent depot transfers", () => {
  it("5 in the gudang; two transfers of 4 at the same time → one succeeds, one is refused for insufficient stock; replaying the successful key changes nothing", async () => {
    const b = (await as(PH, (db) => receiveStock(db, key(), null, { itemId: gauze, batchNo: "C-89", expiry: day(300), quantity: "5", reason: "stok_awal" }))).batchId;
    const k1 = key(); const k2 = key();
    const run = (p: P, k: string) => as(p, (db) => transferBetweenDepots(db, k, { fromDepotId: G1, toDepotId: ROOM, lines: [{ batchId: b, quantity: "4" }] }));
    const r = await Promise.allSettled([run(PH, k1), run(PH2, k2)]);
    const ok = r.filter((x) => x.status === "fulfilled");
    const no = r.filter((x): x is PromiseRejectedResult => x.status === "rejected");
    expect([ok.length, no.length]).toEqual([1, 1]);
    expect((no[0].reason as CommandError).code).toBe("ERR_STOCK_INSUFFICIENT");
    expect([await held(G1, b), await held(ROOM, b)]).toEqual([1, 4]);
    const winner = r[0].status === "fulfilled" ? { p: PH, k: k1 } : { p: PH2, k: k2 };
    const first = (ok[0] as PromiseFulfilledResult<{ transferId: string; replayed: boolean }>).value;
    expect((await h.admin.query(`select command_key from depot_transfers where id = $1`, [(ok[0] as PromiseFulfilledResult<{ transferId: string }>).value.transferId])).rows[0].command_key).toBe(winner.k);
    const replay = await run(winner.p, winner.k);
    expect([replay.replayed, replay.transferId]).toEqual([true, first.transferId]);
    expect([await held(G1, b), await held(ROOM, b)]).toEqual([1, 4]);
    expect((await h.admin.query(`select count(*)::int n from depot_transfers where tenant_id = $1 and from_depot_id = $2 and created_at > now() - interval '1 minute'
                                   and id in (select source_id from stock_movements where batch_id = $3)`, [A.tenantId, G1, b])).rows[0].n).toBe(1);
    // the loser's refusal is stored: its key answers the same refusal without running
    const loser = winner.k === k1 ? { p: PH2, k: k2 } : { p: PH, k: k1 };
    expect(await code(run(loser.p, loser.k))).toBe("ERR_STOCK_INSUFFICIENT");
    await invariant();
  });
});

describe("scenario PR-17 transfer (the transfer half)", () => {
  it("10 at branch A, 0 at B; 4 sent and received → A 6, B 4 with the same batch number and expiry", async () => {
    const exp = day(250);
    const a = (await as(PH, (db) => receiveStock(db, key(), null, { itemId: vial, batchNo: "V-17", expiry: exp, quantity: "10", reason: "stok_awal" }))).batchId;
    const { transferId } = await as(PH, (db) => sendToBranch(db, key(), { fromDepotId: G1, toBranchId: A.b2, lines: [{ batchId: a, quantity: "4" }] }));
    expect([await batchQty(a), await held(G1, a)]).toEqual([6, 6]);
    const inTransit = await as(PHB2, (db) => listTransfers(db, null, "sent"));
    expect(inTransit.map((t) => [t.id, t.state, t.lines[0].quantity])).toEqual([[transferId, "sent", 4]]);
    expect(await code(as(PH, (db) => receiveTransfer(db, key(), transferId, null)))).toBe("ERR_NOT_FOUND"); // the destination branch receives
    await as(PHB2, (db) => receiveTransfer(db, key(), transferId, null));
    const bRow = (await h.admin.query(`select id, batch_no, expiry::text, quantity::int q from stock_batches where branch_id = $1 and item_id = $2`, [A.b2, vial])).rows;
    expect(bRow.map((x) => [x.batch_no, x.expiry, x.q])).toEqual([["V-17", exp, 4]]);
    expect([await batchQty(a), await held(G2, bRow[0].id)]).toEqual([6, 4]);
    const t = await as(PU, (db) => getTransfer(db, transferId));
    expect([t.state, t.to_depot, t.lines[0].destination_batch_id]).toEqual(["received", "Gudang", bRow[0].id]);
    const legs = (await h.admin.query(`select leg, branch_id, quantity::int q from stock_movements where source_id = $1 order by seq`, [transferId])).rows;
    expect(legs).toEqual([{ leg: "out", branch_id: A.b1, q: -4 }, { leg: "in", branch_id: A.b2, q: 4 }]);
    expect(await code(as(PHB2, (db) => receiveTransfer(db, key(), transferId, null)))).toBe("ERR_VERSION_CONFLICT");
    expect(await code(as(PH, (db) => cancelTransfer(db, key(), transferId)))).toBe("ERR_VERSION_CONFLICT");
    // a second shipment of the same batch lands on the same destination batch
    const { transferId: t2 } = await as(PU, (db) => sendToBranch(db, key(), { fromDepotId: G1, toBranchId: A.b2, lines: [{ batchId: a, quantity: "1" }] }));
    await as(PU, (db) => receiveTransfer(db, key(), t2, null));
    expect(await batchQty(bRow[0].id)).toBe(5);
    await invariant();
  });

  it("cancel while sent returns the stock to the source depot; conservation per finished transfer", async () => {
    const a = (await as(PH, (db) => receiveStock(db, key(), null, { itemId: gauze, batchNo: "K-17", expiry: day(300), quantity: "8", reason: "stok_awal" }))).batchId;
    const { transferId } = await as(PH, (db) => sendToBranch(db, key(), { fromDepotId: G1, toBranchId: A.b2, lines: [{ batchId: a, quantity: "3" }] }));
    expect(await held(G1, a)).toBe(5);
    expect(await code(as(PHB2, (db) => cancelTransfer(db, key(), transferId)))).toBe("ERR_NOT_FOUND"); // the source branch cancels
    await as(PH, (db) => cancelTransfer(db, key(), transferId));
    expect([await held(G1, a), await batchQty(a)]).toEqual([8, 8]);
    expect((await as(PH, (db) => getTransfer(db, transferId))).state).toBe("cancelled");
    const sums = (await h.admin.query(`select t.id, sum(m.quantity)::int s from depot_transfers t join stock_movements m on m.source_id = t.id
                                        where t.tenant_id = $1 and t.state in ('posted','received','cancelled') group by t.id having sum(m.quantity) <> 0`, [A.tenantId])).rows;
    expect(sums).toEqual([]);
    await invariant();
  });
});

describe("what may be transferred (open point 5) and line validation (P2-2)", () => {
  it("only fit sealed stock: not the open vial's remainder, not a quarantined or expired batch; lines 1–200, no duplicate batch, positive", async () => {
    const b = (await as(PH, (db) => receiveStock(db, key(), null, { itemId: vial, batchNo: "V-OPEN", expiry: day(200), quantity: "150", reason: "stok_awal" }))).batchId;
    await as(PH, (db) => openVialIn(db, key(), b, G1)); // 100 U open in the gudang
    const tr = (q: string, extra: { batchId: string; quantity: string }[] = []) =>
      as(PH, (db) => transferBetweenDepots(db, key(), { fromDepotId: G1, toDepotId: ROOM, lines: [{ batchId: b, quantity: q }, ...extra] }));
    expect(await code(tr("51"))).toBe("ERR_STOCK_INSUFFICIENT");
    expect(await code(tr("50"))).toBe("ok");
    expect([await held(G1, b), await held(ROOM, b)]).toEqual([100, 50]);
    expect(await code(tr("1", [{ batchId: b, quantity: "1" }]))).toBe("ERR_INVALID_INPUT");
    expect(await code(as(PH, (db) => transferBetweenDepots(db, key(), { fromDepotId: G1, toDepotId: ROOM, lines: [] })))).toBe("ERR_INVALID_INPUT");
    expect(await code(as(PH, (db) => transferBetweenDepots(db, key(), { fromDepotId: G1, toDepotId: G1, lines: [{ batchId: b, quantity: "1" }] })))).toBe("ERR_INVALID_INPUT");
    expect(await code(as(PH, (db) => transferBetweenDepots(db, key(), { fromDepotId: G1, toDepotId: G2, lines: [{ batchId: b, quantity: "1" }] })))).toBe("ERR_NOT_FOUND");
    expect(await code(tr("0"))).toBe("ERR_INVALID_INPUT");
    expect(await code(tr("1e1"))).toBe("ERR_INVALID_INPUT"); // the database would read 10
    const q = (await as(PH, (db) => receiveStock(db, key(), null, { itemId: gauze, batchNo: "K-HOLD", expiry: day(200), quantity: "5", reason: "stok_awal" }))).batchId;
    await as(PH, (db) => holdBatch(db, key(), q, "quarantined", "Kemasan rusak"));
    expect(await reason(as(PH, (db) => transferBetweenDepots(db, key(), { fromDepotId: G1, toDepotId: ROOM, lines: [{ batchId: q, quantity: "1" }] })))).toBe("quarantined");
    expect(await reason(as(PH, (db) => sendToBranch(db, key(), { fromDepotId: G1, toBranchId: A.b2, lines: [{ batchId: q, quantity: "1" }] })))).toBe("quarantined");
    // an expired batch (moved past expiry by the clock: fixture rewrite with guards off)
    const e = (await as(PH, (db) => receiveStock(db, key(), null, { itemId: gauze, batchNo: "K-EXP", expiry: day(3), quantity: "5", reason: "stok_awal" }))).batchId;
    await h.admin.query(`alter table stock_batches disable trigger stock_batches_guard`);
    await h.admin.query(`update stock_batches set expiry = current_date - 1 where id = $1`, [e]);
    await h.admin.query(`alter table stock_batches enable always trigger stock_batches_guard`);
    expect(await reason(as(PH, (db) => transferBetweenDepots(db, key(), { fromDepotId: G1, toDepotId: ROOM, lines: [{ batchId: e, quantity: "1" }] })))).toBe("expired");
    // a batch of another branch is not found
    const other = (await as(PHB2, (db) => receiveStock(db, key(), null, { itemId: gauze, batchNo: "K-B2", expiry: day(200), quantity: "5", reason: "stok_awal" }))).batchId;
    expect(await code(as(PU, (db) => transferBetweenDepots(db, key(), { fromDepotId: G1, toDepotId: ROOM, lines: [{ batchId: other, quantity: "1" }] })))).toBe("ERR_NOT_FOUND");
    await invariant();
  });
});

describe("vials and counts per depot (open point 7)", () => {
  it("a vial opens only on stock held in that depot; receive into a named depot", async () => {
    const b = (await as(PH, (db) => receiveStock(db, key(), null, { itemId: vial, batchNo: "V-RX", expiry: day(200), quantity: "50", reason: "stok_awal" }))).batchId;
    expect(await code(as(PH, (db) => openVialIn(db, key(), b, ROOM)))).toBe("ERR_STOCK_INSUFFICIENT"); // nothing of it in the room
    expect(await code(h.admin.query(`insert into opened_vials (tenant_id, branch_id, batch_id, depot_id, opened_by, opened_as, use_by, remaining)
      values ($1, $2, $3, $4, $5, 'pharmacist', now() + interval '1 day', 10)`, [A.tenantId, A.b1, b, ROOM, PH.staffId]))).toBe("raw:42501");
    // receive straight into the room depot (T-067's goods receipt names a depot the same way)
    const r = await as(PH, (db) => db.query(`select stock_receive($1, $2::jsonb) as r`,
      [A.b1, JSON.stringify({ item_id: vial, batch_no: "V-RX", expiry: day(200), quantity: "7", reason: "penerimaan", depot_id: ROOM })]));
    expect(r.rows[0].r).toBe(b);
    expect([await held(G1, b), await held(ROOM, b)]).toEqual([50, 7]);
    await invariant();
  });

  it("a vial is open in one depot; a downward movement there clamps it; movements elsewhere do not", async () => {
    const b = (await as(PH, (db) => receiveStock(db, key(), null, { itemId: vial, batchNo: "V-CL", expiry: day(200), quantity: "200", reason: "stok_awal" }))).batchId;
    await as(PH, (db) => transferBetweenDepots(db, key(), { fromDepotId: G1, toDepotId: ROOM, lines: [{ batchId: b, quantity: "100" }] }));
    const v1 = (await as(PH, (db) => openVialIn(db, key(), b, ROOM))).vialId;
    const v2 = (await as(PH, (db) => openVialIn(db, key(), b, G1))).vialId;
    expect(await code(as(PH, (db) => openVialIn(db, key(), b, ROOM)))).toBe("ERR_VERSION_CONFLICT");
    // a count of the room depot lowers it to 30: the room's vial clamps to 30, the gudang's stays 100
    const { countId } = await as(PH, (db) => startDepotCount(db, key(), false, [vial], ROOM));
    const lines = (await as(PH, (db) => getCount(db, countId))).lines;
    // one line per holding of the item in the room depot (other batches moved there earlier count too, unchanged)
    const mine = lines.find((l) => l.batch_no === "V-CL")!;
    expect(mine.system_qty).toBe(100);
    expect(new Set(lines.map((l) => l.batch_id)).size).toBe(lines.length);
    for (const l of lines) await as(PH, (db) => recordCount(db, key(), countId, l.id, l === mine ? "30" : String(l.system_qty)));
    // a transfer from the gudang while the room's count is open does not touch the counted holding: the room count still applies
    const ruangDua = (await as(PH, (db) => listDepots(db, null))).find((x) => x.name === "Ruang Dua")!.id;
    await as(PH, (db) => receiveStock(db, key(), null, { itemId: vial, batchNo: "V-CL", expiry: day(200), quantity: "1", reason: "penerimaan" })); // 1 free in the gudang
    await as(PH, (db) => transferBetweenDepots(db, key(), { fromDepotId: G1, toDepotId: ruangDua, lines: [{ batchId: b, quantity: "1" }] }));
    expect((await as(PH, (db) => submitCount(db, key(), countId, "Opname ruang"))).state).toBe("pending_approval");
    const ap = (await h.admin.query(`select approval_id from stock_counts where id = $1`, [countId])).rows[0].approval_id;
    await as(OWN, (db) => db.query(`select approval_decide($1, true, null)`, [ap]));
    const rem = async (v: string) => Number((await h.admin.query(`select remaining from opened_vials where id = $1`, [v])).rows[0].remaining);
    expect([await held(ROOM, b), await rem(v1), await rem(v2)]).toEqual([30, 30, 100]);
    expect((await h.admin.query(`select depot_id, batch_id from stock_movements where source_id = $1`, [countId])).rows).toEqual([{ depot_id: ROOM, batch_id: b }]);
    // a movement on the counted holding after the count started refuses the submit
    const c2 = await as(PH, (db) => startDepotCount(db, key(), false, [vial], ROOM));
    const l2 = (await as(PH, (db) => getCount(db, c2.countId))).lines;
    for (const l of l2) await as(PH, (db) => recordCount(db, key(), c2.countId, l.id, String(l.system_qty)));
    const other2 = l2.find((l) => l.batch_id !== b) ?? l2[0];
    await h.admin.query(`select stock_move_depot($1, $2, $3, 'adjust', -1, null, 'test', gen_random_uuid(), $4, 'pharmacist', null)`, [A.tenantId, other2.batch_id, ROOM, PH.staffId]);
    expect(await code(as(PH, (db) => submitCount(db, key(), c2.countId, "Opname ruang lagi")))).toBe("ERR_VERSION_CONFLICT");
    // the room's vial still holds 30 of the room's 30: nothing of it can be transferred out
    expect(await code(as(PH, (db) => transferBetweenDepots(db, key(), { fromDepotId: ROOM, toDepotId: G1, lines: [{ batchId: b, quantity: "1" }] })))).toBe("ERR_STOCK_INSUFFICIENT");
    await invariant();
  });

  it("the T-060 functions see every depot: a branch-wide count has a line per holding; FEFO counts each depot's open vial once", async () => {
    const b = (await as(PH, (db) => receiveStock(db, key(), null, { itemId: vial, batchNo: "V-FF", expiry: day(150), quantity: "300", reason: "stok_awal" }))).batchId;
    await as(PH, (db) => transferBetweenDepots(db, key(), { fromDepotId: G1, toDepotId: ROOM, lines: [{ batchId: b, quantity: "150" }] }));
    await as(PH, (db) => openVialIn(db, key(), b, ROOM));
    await as(PH, (db) => openVialIn(db, key(), b, G1));
    // take everything fit at the branch: V-FF contributes its 300 exactly once (two open vials, each counted once)
    const total = Number((await h.admin.query(`select sum(stock_fit_qty(b)) s from stock_batches b where branch_id = $1 and item_id = $2`, [A.b1, vial])).rows[0].s);
    const fefo = (await h.admin.query(`select batch_id, vial_id is not null as v, take::int t from stock_fefo($1, $2, $3, $4) where batch_id = $5`, [A.tenantId, A.b1, vial, total, b])).rows;
    expect(fefo.reduce((s, r) => s + r.t, 0)).toBe(300);
    expect(fefo.filter((r) => r.v).length).toBe(2);
    // two lapsed vials of one batch (one per depot): the branch-wide fit quantity drops by both remainders
    await h.admin.query(`alter table opened_vials disable trigger opened_vials_guard`);
    await h.admin.query(`update opened_vials set opened_at = now() - interval '30 hours', use_by = now() - interval '1 hour' where batch_id = $1 and state = 'open'`, [b]);
    await h.admin.query(`alter table opened_vials enable always trigger opened_vials_guard`);
    expect(Number((await h.admin.query(`select stock_fit_qty(x) f from stock_batches x where id = $1`, [b])).rows[0].f)).toBe(100);
    const item = (await as(PH, (db) => db.query(`select stock_item_get($1, null) as r`, [vial]))).rows[0].r;
    const row = item.batches.find((x: { batch_no: string }) => x.batch_no === "V-FF");
    expect([row.vials.length, row.holdings.length, typeof row.vial.remaining]).toEqual([2, 2, "number"]);
  });
});

describe("guards (plan P1-2, P2-2)", () => {
  it("a holding changes only by its movement; movements name a depot of their batch's branch; nothing is deleted; legs tie to kinds", async () => {
    const hh = (await h.admin.query(`select * from batch_holdings where depot_id = $1 and quantity > 0 limit 1`, [G1])).rows[0];
    expect(await code(h.admin.query(`update batch_holdings set quantity = quantity + 1 where id = $1`, [hh.id]))).toBe("raw:42501");
    expect(await code(h.admin.query(`delete from batch_holdings where id = $1`, [hh.id]))).toBe("raw:42501");
    expect(await code(h.admin.query(`insert into batch_holdings (tenant_id, branch_id, depot_id, item_id, batch_id, quantity) values ($1, $2, $3, $4, $5, 9)`,
      [hh.tenant_id, hh.branch_id, ROOM, hh.item_id, hh.batch_id]))).toBe("raw:42501");
    expect(await code(h.admin.query(`truncate batch_holdings`))).toBe("raw:42501");
    expect(await code(h.admin.query(`select stock_move_depot($1, $2, $3, 'adjust', 1, null, 'test', gen_random_uuid(), $4, 'pharmacist', null)`,
      [hh.tenant_id, hh.batch_id, G2, PH.staffId]))).toBe("raw:P0002"); // the other branch's gudang
    expect(await code(h.admin.query(`select stock_move_depot($1, $2, $3, 'transfer_out', -1, null, 'test', gen_random_uuid(), $4, 'pharmacist', null)`,
      [hh.tenant_id, hh.batch_id, G1, PH.staffId]))).toBe("raw:23514"); // a transfer kind without its leg
    expect(await code(h.admin.query(`select stock_move_depot($1, $2, $3, 'adjust', -100000, null, 'test', gen_random_uuid(), $4, 'pharmacist', null)`,
      [hh.tenant_id, hh.batch_id, G1, PH.staffId]))).toBe("raw:P0422");
    // a depot holding never goes negative even when the batch as a whole has enough (the other depot holds it)
    const split = (await as(PH, (db) => receiveStock(db, key(), null, { itemId: gauze, batchNo: "K-SPL", expiry: day(200), quantity: "10", reason: "stok_awal" }))).batchId;
    await as(PH, (db) => transferBetweenDepots(db, key(), { fromDepotId: G1, toDepotId: ROOM, lines: [{ batchId: split, quantity: "3" }] }));
    expect(await code(h.admin.query(`select stock_move_depot($1, $2, $3, 'adjust', -4, null, 'test', gen_random_uuid(), $4, 'pharmacist', null)`,
      [hh.tenant_id, split, ROOM, PH.staffId]))).toBe("raw:P0422");
    // a raw movement must continue the depot balance and name a depot of the batch's branch
    const raw = (depot: string, dep: number | null) => h.admin.query(
      `insert into stock_movements (tenant_id, branch_id, item_id, batch_id, depot_id, kind, quantity, balance_after, depot_balance_after, source_kind, source_id, created_by, created_as)
       select tenant_id, branch_id, item_id, id, $2, 'adjust', 1, quantity + 1, $3, 'test', gen_random_uuid(), $4, 'pharmacist' from stock_batches where id = $1`, [split, depot, dep, PH.staffId]);
    expect(await code(raw(ROOM, 99))).toBe("raw:42501");
    expect(await code(raw(G2, 1))).toMatch(/raw:(42501|23503)/);
    expect(await code(h.admin.query(`alter table stock_movements disable trigger stock_movements_guard`).then(() => raw(G2, 1)).finally(() =>
      h.admin.query(`alter table stock_movements enable always trigger stock_movements_guard`)))).toBe("raw:23503"); // the composite key too
    const t = (await h.admin.query(`select id from depot_transfers where tenant_id = $1 limit 1`, [A.tenantId])).rows[0].id;
    expect(await code(h.admin.query(`delete from depot_transfers where id = $1`, [t]))).toBe("raw:42501");
    expect(await code(h.admin.query(`update depot_transfers set state = 'cancelled' where id = $1`, [t]))).toBe("raw:42501");
    // a line added after the transfer moved stock (another batch: not a duplicate key) is refused
    const other = (await h.admin.query(`select b.id, b.item_id from stock_batches b join depot_transfer_lines l on l.transfer_id = $1 and l.from_branch_id = b.branch_id
                                         where b.id <> l.source_batch_id limit 1`, [t])).rows[0];
    expect(await code(h.admin.query(`insert into depot_transfer_lines (tenant_id, transfer_id, from_branch_id, to_branch_id, item_id, source_batch_id, quantity)
      select tenant_id, transfer_id, from_branch_id, to_branch_id, $2, $3, 1 from depot_transfer_lines where transfer_id = $1 limit 1`, [t, other.item_id, other.id]))).toBe("raw:42501");
    // the guards fire with replication triggers off too
    await h.admin.query("begin");
    try {
      await h.admin.query("set local session_replication_role = replica");
      expect(await code(h.admin.query(`delete from batch_holdings where id = $1`, [hh.id]))).toBe("raw:42501");
    } finally {
      await h.admin.query("rollback");
    }
    await invariant();
  });
});

describe("readers, roles and lifecycle", () => {
  it("transfers: pharmacist at the source or purchasing send; others refused; readers by branch; both branches see a transfer", async () => {
    const b = (await as(PH, (db) => receiveStock(db, key(), null, { itemId: gauze, batchNo: "K-RD", expiry: day(200), quantity: "9", reason: "stok_awal" }))).batchId;
    for (const p of [MGR, OWN, AP, AU, DOC]) expect(await code(as(p, (db) => transferBetweenDepots(db, key(), { fromDepotId: G1, toDepotId: ROOM, lines: [{ batchId: b, quantity: "1" }] })))).toBe("ERR_FORBIDDEN");
    expect(await code(as(PHB2, (db) => transferBetweenDepots(db, key(), { fromDepotId: G1, toDepotId: ROOM, lines: [{ batchId: b, quantity: "1" }] })))).toBe("ERR_NOT_FOUND");
    const { transferId } = await as(PU, (db) => sendToBranch(db, key(), { fromDepotId: G1, toBranchId: A.b2, lines: [{ batchId: b, quantity: "2" }] }));
    for (const p of [PH, PHB2, AU, MGR]) expect((await as(p, (db) => getTransfer(db, transferId))).id).toBe(transferId);
    const lonely = await person(A, "pharmacist", (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, 'D3', 'D3', 'Asia/Jakarta') returning id`, [A.tenantId])).rows[0].id);
    expect(await code(as(lonely, (db) => getTransfer(db, transferId)))).toBe("ERR_NOT_FOUND");
    // a pharmacist holding roles at both D2 and D3 but acting at D3 does not read a D1 → D2 transfer through the definer
    const both = await person(A, "pharmacist", (await h.admin.query(`select branch_id from depots where tenant_id = $1 and branch_id not in ($2, $3) and is_default limit 1`, [A.tenantId, A.b1, A.b2])).rows[0].branch_id, A.b2);
    expect(await code(as(both, (db) => getTransfer(db, transferId)))).toBe("ERR_NOT_FOUND");
    expect((await as(lonely, (db) => db.query(`select count(*)::int n from depot_transfers where id = $1`, [transferId]))).rows[0].n).toBe(0);
    expect((await as(PHB2, (db) => db.query(`select count(*)::int n from depot_transfer_lines where transfer_id = $1`, [transferId]))).rows[0].n).toBe(1);
    expect(await code(as(DOC, (db) => listDepots(db, null)))).toBe("ERR_FORBIDDEN");
    const d = await as(AU, (db) => getDepot(db, ROOM));
    expect(d.holdings.length).toBeGreaterThan(0);
    await as(PU, (db) => cancelTransfer(db, key(), transferId));
  });

  it("an exited tenant cannot transfer; events carry ids and codes only", async () => {
    const E = await tenant("exit");
    const EPH = await person(E, "pharmacist", E.b1);
    expect(await code(as(EPH, (db) => transferBetweenDepots(db, key(), { fromDepotId: crypto.randomUUID(), toDepotId: crypto.randomUUID(), lines: [] })))).toBe("ERR_TENANT_SUSPENDED");
    const ev = (await h.admin.query(`select payload::text p from domain_events where tenant_id = $1 and type = 'StockTransferred'`, [A.tenantId])).rows;
    expect(ev.length).toBeGreaterThan(3);
    expect(ev.map((e) => e.p).join(" ")).not.toMatch(/kasa|toksin|gudang|ruang|"quantity"|\d+\.\d/i);
  });
});

describe("cross-tenant", () => {
  it("B's pharmacist neither reads nor moves A's depots or transfers", async () => {
    const t = (await h.admin.query(`select id from depot_transfers where tenant_id = $1 limit 1`, [A.tenantId])).rows[0].id;
    const b = (await h.admin.query(`select batch_id from batch_holdings where depot_id = $1 and quantity > 0 limit 1`, [G1])).rows[0].batch_id;
    expect(await code(as(BPH, (db) => getDepot(db, G1)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BPH, (db) => getTransfer(db, t)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BPH, (db) => transferBetweenDepots(db, key(), { fromDepotId: G1, toDepotId: ROOM, lines: [{ batchId: b, quantity: "1" }] })))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BPH, (db) => receiveTransfer(db, key(), t, null)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BPH, (db) => updateDepot(db, key(), ROOM, { name: "X", active: true })))).toBe("ERR_NOT_FOUND");
    expect((await as(BPH, (db) => db.query(`select count(*)::int n from batch_holdings`))).rows[0].n).toBe(0);
    expect((await as(BPH, (db) => listDepots(db, null))).map((d) => d.name)).toEqual(["Gudang"]);
  });
});
