// T-066 Done-when: scenario PR-75 — a batch received from a supplier; purchasing returns 5 units with a reason; stock
// decreases by 5 at the moving average cost and a credit note is expected (BILL-30). Plus the plan review: the supplier
// master (roles, unique name, never deleted); receipts recorded per supplier, batch and branch (reusable by T-067);
// returns of unfit stock (expired, quarantined, temperature excursion, recalled) allowed; an open vial's remainder
// stays; never more than delivered or held; another supplier's, branch's or tenant's batch refused; a non-default
// active depot, an inactive one refused; replay; roles; uncosted returns; events ids only; money columns hidden from
// non-cost readers (column grants and readers); guards and replica mode. Synthetic data (MIG-2).
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { publish } from "../../src/modules/catalog/catalog";
import { listCosts } from "../../src/modules/inventory/costing/costing";
import { createDepot, transferBetweenDepots } from "../../src/modules/inventory/depots/depots";
import { holdBatch, openVial, receiveStock, saveItem } from "../../src/modules/inventory/stock";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import {
  getSupplier, listReturns, listSuppliers, receiveFromSupplier, returnableBatches, returnToSupplier, saveSupplier,
} from "../../src/modules/purchasing/suppliers/suppliers";
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
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Pemasok Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
  return { tenantId, b1: await br("S1"), b2: await br("S2") };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email) values ('X', $1) returning id`, [`sup${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Pembelian ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  if (!TENANT_WIDE.includes(role)) for (const b of branches.length ? branches : [t.b1]) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, tenantId: t.tenantId, role, branch: TENANT_WIDE.includes(role) ? undefined : branches[0] ?? t.b1 };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
const why = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? `${e.code}:${(e as { reason?: string }).reason ?? ""}` : `raw:${e.code ?? e.message}`));
const key = () => crypto.randomUUID();
const day = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
const num = (x: unknown) => Number(x);
const holding = async (batch: string, depot: string) => num((await h.admin.query(`select coalesce((select quantity from batch_holdings where batch_id = $1 and depot_id = $2), 0) q`, [batch, depot])).rows[0].q);

let A: T; let B: T;
let OWN: P; let ADM: P; let FIN: P; let PUR: P; let AUD: P; let MGR: P; let PH: P; let PHB2: P; let FO: P; let BPUR: P;
let item: string; let item2: string; let vialItem: string; let SUP: string; let SUP2: string; let G1: string;
let costOf: (b: string) => Promise<{ quantity: number; value: number; uncosted: number }>;

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 6 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant();
  B = await tenant();
  OWN = await person(A, "owner"); ADM = await person(A, "admin_pusat"); FIN = await person(A, "finance"); PUR = await person(A, "purchasing"); AUD = await person(A, "auditor");
  MGR = await person(A, "manager", A.b1); PH = await person(A, "pharmacist", A.b1); PHB2 = await person(A, "pharmacist", A.b2); FO = await person(A, "fo_cashier", A.b1);
  BPUR = await person(B, "purchasing");
  const stock = async (c: string, name: string, unit: string, vial = false) => {
    const cat = (await as(OWN, (db) => publish(db, { kind: "material", code: c }, { name, tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 1_000 } as never, "Bahan"))).itemId;
    return (await as(PH, (db) => saveItem(db, key(), null, { catalogItemId: cat, unit, storage: "ruang", highValue: false, active: true, ...(vial ? { vialSize: "10", openedUseHours: 24 } : {}) }))).itemId;
  };
  item = await stock("SP-AMP", "Ampul Vitamin", "amp");
  item2 = await stock("SP-KSA", "Kasa Pemasok", "lembar");
  vialItem = await stock("SP-VIA", "Vial Toksin", "U", true);
  SUP = (await as(PUR, (db) => saveSupplier(db, key(), null, { name: "PT Farma Sintetis", npwp: "0123456789012345", paymentTermsDays: 30, email: "Order@Farma.test" }))).supplierId;
  SUP2 = (await as(PUR, (db) => saveSupplier(db, key(), null, { name: "CV Medika Uji" }))).supplierId;
  G1 = (await h.admin.query(`select id from depots where branch_id = $1 and is_default`, [A.b1])).rows[0].id;
  costOf = async (it: string) => {
    const r = (await as(FIN, (db) => listCosts(db, A.b1))).items.find((x: { item_id: string }) => x.item_id === it) as { quantity: number; value: number; uncosted_quantity: number };
    return { quantity: num(r.quantity), value: num(r.value), uncosted: num(r.uncosted_quantity) };
  };
}, 300_000);
afterAll(async () => {
  await app?.end();
  await owner?.end();
  await h?.close();
});

const recv = (who: P, supplier: string, it: string, batchNo: string, q: string, unitCost: number, branch: string | null = null, exp = 200) =>
  as(who, (db) => receiveFromSupplier(db, key(), branch, { supplierId: supplier, itemId: it, batchNo, expiry: day(exp), quantity: q, unitCost, reason: "penerimaan" }));
const batchOf = async (receipt: string) => (await h.admin.query(`select batch_id from supplier_receipts where id = $1`, [receipt])).rows[0].batch_id as string;

describe("scenario PR-75: supplier return", () => {
  it("a batch received from a supplier; 5 units returned with a reason → stock −5 at the moving average; a credit note is expected", async () => {
    const r1 = await recv(PUR, SUP, item, "AMP-1", "10", 10_000, A.b1); // 10 × 10,000
    const r2 = await recv(PH, SUP, item, "AMP-2", "10", 13_000);        // 10 × 13,000 → average 11,500
    const b1 = await batchOf(r1.receiptId);
    expect(await costOf(item)).toEqual({ quantity: 20, value: 230_000, uncosted: 0 });
    const { returnId } = await as(PUR, (db) => returnToSupplier(db, key(), A.b1, { supplierId: SUP, batchId: b1, quantity: "5", reason: "damaged", note: "Kemasan pecah saat diterima" }));
    expect(await holding(b1, G1)).toBe(5);
    expect(await costOf(item)).toEqual({ quantity: 15, value: 172_500, uncosted: 0 }); // 230,000 − 5 × 11,500
    const ret = (await h.admin.query(`select quantity::int q, value::int v, reason, note, returned_as from supplier_returns where id = $1`, [returnId])).rows[0];
    expect(ret).toEqual({ q: 5, v: 57_500, reason: "damaged", note: "Kemasan pecah saat diterima", returned_as: "purchasing" });
    const mv = (await h.admin.query(`select m.kind, m.quantity::int q, m.depot_id, v.value::int v from stock_movements m join stock_movement_values v on v.movement_id = m.id
                                     where m.source_kind = 'supplier_return' and m.source_id = $1`, [returnId])).rows;
    expect(mv).toEqual([{ kind: "supplier_return", q: -5, depot_id: G1, v: -57_500 }]);
    const exp = (await h.admin.query(`select amount::int a, uncosted, state, supplier_id from supplier_credit_expectations where return_id = $1`, [returnId])).rows;
    expect(exp).toEqual([{ a: 57_500, uncosted: false, state: "expected", supplier_id: SUP }]);
    const ev = (await h.admin.query(`select payload from domain_events where type = 'SupplierReturned' and aggregate_id = $1`, [returnId])).rows;
    expect(ev).toHaveLength(1);
    expect(Object.keys(ev[0].payload).sort()).toEqual(["batch_id", "expectation_id", "return_id", "supplier_id"]);
    expect(ev[0].payload).toMatchObject({ return_id: returnId, supplier_id: SUP, batch_id: b1 });
    void r2;
  });
});

describe("supplier master (open point 1)", () => {
  it("purchasing, admin pusat, owner write; unique name; never deleted; deactivated suppliers deliver nothing", async () => {
    for (const p of [PH, MGR, FIN, AUD, FO]) expect(await code(as(p, (db) => saveSupplier(db, key(), null, { name: `Pemasok ${p.role}` })))).toBe("ERR_FORBIDDEN");
    expect(await code(as(BPUR, (db) => saveSupplier(db, key(), SUP, { name: "Ambil alih" })))).toBe("ERR_NOT_FOUND");
    expect(await why(as(ADM, (db) => saveSupplier(db, key(), null, { name: "  pt farma sintetis " })))).toBe("ERR_VERSION_CONFLICT:duplicate_name");
    for (const unitCost of [1.5, -1, Number.NaN, 2_000_000_000]) expect(await code(recv(PUR, SUP, item, "UC-X", "1", unitCost, A.b1)), String(unitCost)).toBe("ERR_INVALID_INPUT");
    expect(await code(as(OWN, (db) => saveSupplier(db, key(), null, { name: "PT Npwp Salah", npwp: "12345" })))).toBe("ERR_INVALID_INPUT");
    expect(await code(as(OWN, (db) => saveSupplier(db, key(), null, { name: "PT Tempo", paymentTermsDays: 181 })))).toBe("ERR_INVALID_INPUT");
    const k = key();
    const { supplierId: s3 } = await as(ADM, (db) => saveSupplier(db, k, null, { name: "UD Nonaktif" }));
    expect((await as(ADM, (db) => saveSupplier(db, k, null, { name: "UD Nonaktif" }))).supplierId).toBe(s3); // replay
    await as(ADM, (db) => saveSupplier(db, key(), s3, { name: "UD Nonaktif", active: false }));
    expect(await why(recv(PUR, s3, item, "NA-1", "1", 1, A.b1))).toBe("ERR_VERSION_CONFLICT:the supplier is inactive");
    const list = await as(PH, listSuppliers);
    expect(list.map((s) => s.name)).toEqual(expect.arrayContaining(["PT Farma Sintetis", "CV Medika Uji", "UD Nonaktif"]));
    expect(list.find((s) => s.id === SUP)).toMatchObject({ email: "order@farma.test", payment_terms_days: 30, active: true });
    expect(await code(as(FO, listSuppliers))).toBe("ERR_FORBIDDEN");
    expect(await as(BPUR, listSuppliers)).toEqual([]);
    expect(await code(h.admin.query(`delete from suppliers where id = $1`, [s3]))).toBe("raw:42501");
    expect(await code(h.admin.query(`update suppliers set created_by = $2 where id = $1`, [s3, OWN.staffId]))).toBe("raw:42501");
  });
});

describe("supplier returns (open point 3)", () => {
  it("unfit stock goes back: expired, quarantined, temperature excursion, recalled", async () => {
    for (const [i, state] of (["quarantined", "temperature_excursion", "recalled"] as const).entries()) {
      const { receiptId } = await recv(PUR, SUP, item2, `UF-${i}`, "6", 2_000, A.b1);
      const b = await batchOf(receiptId);
      await as(PH, (db) => holdBatch(db, key(), b, state, "Ditahan untuk uji retur"));
      expect(await code(as(PUR, (db) => returnToSupplier(db, key(), A.b1, { supplierId: SUP, batchId: b, quantity: "6", reason: state === "recalled" ? "recalled" : "quality", note: "Dikembalikan ke pemasok" })))).toBe("ok");
      expect(await holding(b, G1)).toBe(0);
    }
    // expired: received fit, then the day passes (the expiry is moved back on the owner connection)
    const { receiptId } = await recv(PUR, SUP, item2, "UF-EXP", "4", 2_000, A.b1, 10);
    const b = await batchOf(receiptId);
    await h.admin.query(`alter table stock_batches disable trigger stock_batches_guard`);
    await h.admin.query(`update stock_batches set expiry = current_date - 1 where id = $1`, [b]);
    await h.admin.query(`alter table stock_batches enable always trigger stock_batches_guard`);
    expect(await code(as(PUR, (db) => returnToSupplier(db, key(), A.b1, { supplierId: SUP, batchId: b, quantity: "4", reason: "expired", note: "Kedaluwarsa" })))).toBe("ok");
  });

  it("never more than delivered (net of returns) or held; another supplier's, branch's or tenant's batch refused; an open vial's remainder stays", async () => {
    const { receiptId } = await recv(PUR, SUP, item2, "LIM-1", "8", 3_000, A.b1);
    const b = await batchOf(receiptId);
    const ret = (q: string, who: P = PUR, branch: string | null = A.b1, sup = SUP, batch = b) =>
      as(who, (db) => returnToSupplier(db, key(), branch, { supplierId: sup, batchId: batch, quantity: q, reason: "other", note: "Uji batas retur" }));
    expect(await why(ret("9"))).toBe("ERR_INVALID_INPUT:not_delivered");
    expect(await why(ret("1", PUR, A.b1, SUP2))).toBe("ERR_INVALID_INPUT:not_delivered"); // another supplier
    expect(await code(ret("1", PUR, A.b2))).toBe("ERR_NOT_FOUND"); // another branch
    expect(await code(ret("1", PHB2, null))).toBe("ERR_NOT_FOUND");
    expect(await code(ret("1", BPUR, B.b1, SUP, b))).toBe("ERR_NOT_FOUND"); // another tenant
    await ret("5");
    expect(await why(ret("4"))).toBe("ERR_INVALID_INPUT:not_delivered"); // 8 − 5 = 3 open
    // held: 3 open to the supplier but 2 moved to another depot → 1 in the gudang
    const apt = (await as(PH, (db) => createDepot(db, key(), { branchId: null, name: "Apotek Retur", kind: "apotek" }))).depotId;
    await as(PH, (db) => transferBetweenDepots(db, key(), { fromDepotId: G1, toDepotId: apt, lines: [{ batchId: b, quantity: "2" }] }));
    expect(await code(ret("2"))).toBe("ERR_STOCK_INSUFFICIENT");
    // a non-default active depot
    expect(await code(as(PUR, (db) => returnToSupplier(db, key(), A.b1, { supplierId: SUP, batchId: b, quantity: "2", reason: "other", note: "Dari apotek", depotId: apt })))).toBe("ok");
    expect(await holding(b, apt)).toBe(0);
    // an inactive depot
    await h.admin.query(`update depots set active = false where id = $1`, [apt]);
    expect(await why(as(PUR, (db) => returnToSupplier(db, key(), A.b1, { supplierId: SUP, batchId: b, quantity: "1", reason: "other", note: "Depot nonaktif", depotId: apt })))).toBe("ERR_VERSION_CONFLICT:the depot is inactive");
    // an open vial: only the sealed part may go back
    const v = await recv(PH, SUP, vialItem, "VIA-1", "30", 50_000);
    const vb = await batchOf(v.receiptId);
    await as(PH, (db) => openVial(db, key(), vb));
    expect(await code(ret("21", PUR, A.b1, SUP, vb))).toBe("ERR_STOCK_INSUFFICIENT");
    expect(await code(ret("20", PUR, A.b1, SUP, vb))).toBe("ok");
    expect((await h.admin.query(`select state, remaining::int r from opened_vials where batch_id = $1`, [vb])).rows[0]).toEqual({ state: "open", r: 10 });
  });

  it("roles: purchasing, pharmacist, manager (own branch), admin pusat, owner (named branch); replay; quantity and reason checked", async () => {
    const { receiptId } = await recv(PUR, SUP, item2, "ROL-1", "20", 1_000, A.b1);
    const b = await batchOf(receiptId);
    const ret = (who: P, branch: string | null, k = key(), q = "1") => as(who, (db) => returnToSupplier(db, k, branch, { supplierId: SUP, batchId: b, quantity: q, reason: "wrong_item", note: "Salah kirim" }));
    for (const [p, br] of [[PUR, A.b1], [PH, null], [MGR, null], [ADM, A.b1], [OWN, A.b1]] as const) expect(await code(ret(p, br)), p.role).toBe("ok");
    for (const p of [FIN, AUD, FO]) expect(await code(ret(p, A.b1)), p.role).toBe("ERR_FORBIDDEN");
    expect(await code(ret(MGR, A.b2))).toBe("ERR_FORBIDDEN");
    expect(await code(ret(PUR, null))).toBe("ERR_INVALID_INPUT"); // a tenant-wide role names the branch
    const k = key();
    const first = await ret(PUR, A.b1, k);
    const again = await ret(PUR, A.b1, k);
    expect(again).toEqual({ returnId: first.returnId, replayed: true });
    expect(await holding(b, G1)).toBe(14);
    expect(await code(ret(PUR, A.b1, key(), "0"))).toBe("ERR_INVALID_INPUT");
    expect(await code(ret(PUR, A.b1, key(), "1e1"))).toBe("ERR_INVALID_INPUT"); // plain decimals only (the module)
    expect(await holding(b, G1)).toBe(14);
    expect(await code(as(PUR, (db) => returnToSupplier(db, key(), A.b1, { supplierId: SUP, batchId: b, quantity: "1", reason: "bosan" as never, note: "Alasan salah" })))).toBe("ERR_INVALID_INPUT");
    expect(await code(as(PUR, (db) => returnToSupplier(db, key(), A.b1, { supplierId: SUP, batchId: b, quantity: "1", reason: "other", note: "x" })))).toBe("ERR_INVALID_INPUT");
  });

  it("an uncosted batch (received without a cost before T-063 pricing) still expects a credit note, flagged uncosted with amount 0", async () => {
    const t = await tenant();
    const own = await person(t, "owner"); const ph = await person(t, "pharmacist", t.b1); const pur = await person(t, "purchasing");
    const cat = (await as(own, (db) => publish(db, { kind: "material", code: "UC-1" }, { name: "Tanpa Biaya", tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 1 } as never, "Bahan"))).itemId;
    const it = (await as(ph, (db) => saveItem(db, key(), null, { catalogItemId: cat, unit: "pcs", storage: "ruang", highValue: false, active: true }))).itemId;
    // stock held before T-063 pricing (an uncosted receipt) and the supplier's costed delivery; an earlier outflow took
    // the costed units first (0080), so the supplier's units now count as uncosted: the return is valued 0
    const old = (await as(ph, (db) => receiveStock(db, key(), null, { itemId: it, batchNo: "UC-0", expiry: day(100), quantity: "5", reason: "stok_awal" }))).batchId;
    const sup = (await as(pur, (db) => saveSupplier(db, key(), null, { name: "PT Uncosted" }))).supplierId;
    const r = await as(pur, (db) => receiveFromSupplier(db, key(), t.b1, { supplierId: sup, itemId: it, batchNo: "UC-1", expiry: day(100), quantity: "3", unitCost: 1_000, reason: "penerimaan" }));
    await h.admin.query(`select stock_move($1, $2, 'adjust', -3, 'Selisih hitung', 'stock_adjust', gen_random_uuid(), $3, 'pharmacist')`, [t.tenantId, old, ph.staffId]);
    const b = await batchOf(r.receiptId);
    const { returnId } = await as(pur, (db) => returnToSupplier(db, key(), t.b1, { supplierId: sup, batchId: b, quantity: "3", reason: "other", note: "Uji tanpa biaya" }));
    const e = (await h.admin.query(`select amount::int a, uncosted from supplier_credit_expectations where return_id = $1`, [returnId])).rows[0];
    const u = (await h.admin.query(`select uncosted_qty::float u from supplier_returns where id = $1`, [returnId])).rows[0].u;
    expect({ a: e.a, uncosted: e.uncosted, u }).toEqual({ a: 0, uncosted: true, u: 3 });
  });
});

describe("readers, money visibility, guards (open points 2, 4, 6; findings 1–3)", () => {
  it("money only for cost readers: column grants hide unit cost and return value; readers mask them", async () => {
    const { receiptId } = await recv(PUR, SUP, item, "MON-1", "4", 20_000, A.b1);
    const b = await batchOf(receiptId);
    const { returnId } = await as(PUR, (db) => returnToSupplier(db, key(), A.b1, { supplierId: SUP, batchId: b, quantity: "1", reason: "quality", note: "Uji visibilitas" }));
    expect(await code(as(PH, (db) => db.query(`select unit_cost from supplier_receipts where id = $1`, [receiptId])))).toBe("raw:42501");
    expect(await code(as(FIN, (db) => db.query(`select value from supplier_returns where id = $1`, [returnId])))).toBe("raw:42501");
    expect((await as(PH, (db) => db.query(`select quantity from supplier_receipts where id = $1`, [receiptId]))).rows.length).toBe(1);
    expect((await as(PH, (db) => db.query(`select id from supplier_credit_expectations where return_id = $1`, [returnId]))).rows.length).toBe(0);
    expect((await as(FIN, (db) => db.query(`select amount from supplier_credit_expectations where return_id = $1`, [returnId]))).rows.length).toBe(1);
    expect((await as(PHB2, (db) => db.query(`select id from supplier_returns where id = $1`, [returnId]))).rows.length).toBe(0);
    expect((await as(BPUR, (db) => db.query(`select id from supplier_returns where id = $1`, [returnId]))).rows.length).toBe(0);
    const phList = (await as(PH, (db) => listReturns(db, null))).find((r) => r.id === returnId)!;
    expect(phList.value).toBeUndefined();
    expect(phList.expectation).toBeUndefined();
    const finList = (await as(FIN, (db) => listReturns(db, A.b1))).find((r) => r.id === returnId)!;
    expect(finList).toMatchObject({ quantity: 1, reason: "quality", expectation: { state: "expected", uncosted: false } });
    expect(num(finList.value)).toBeGreaterThan(0);
    const phSup = await as(PH, (db) => getSupplier(db, SUP));
    expect(phSup.receipts.find((r) => r.id === receiptId)!.unit_cost).toBeNull();
    const purSup = await as(PUR, (db) => getSupplier(db, SUP));
    expect(num(purSup.receipts.find((r) => r.id === receiptId)!.unit_cost)).toBe(20_000);
    expect((await as(PHB2, (db) => getSupplier(db, SUP))).receipts.find((r) => r.id === receiptId)).toBeUndefined();
    expect(await code(as(BPUR, (db) => getSupplier(db, SUP)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(FO, (db) => listReturns(db, A.b1)))).toBe("ERR_FORBIDDEN");
    const rb = (await as(PUR, (db) => returnableBatches(db, SUP, A.b1))).find((x) => x.batch_id === b)!;
    expect({ open: num(rb.open), depots: rb.depots.map((d) => [d.depot_id, num(d.sealed)]) }).toEqual({ open: 3, depots: [[G1, 3]] });
    expect(await code(as(PHB2, (db) => returnableBatches(db, SUP, A.b1)))).toBe("ERR_NOT_FOUND");
  });

  it("receipts are T-067-reusable and insert-only; returns and expectations insert-only; expectations close once; replica mode", async () => {
    const { receiptId } = await recv(PUR, SUP, item, "GRD-1", "3", 5_000, A.b1);
    const b = await batchOf(receiptId);
    const { returnId } = await as(PUR, (db) => returnToSupplier(db, key(), A.b1, { supplierId: SUP, batchId: b, quantity: "1", reason: "other", note: "Uji penjaga" }));
    const raw = (sql: string, args: unknown[] = []) => code(h.admin.query(sql, args));
    expect((await h.admin.query(`select source_kind, source_id = id s from supplier_receipts where id = $1`, [receiptId])).rows[0]).toEqual({ source_kind: "supplier_receipt", s: true });
    expect((await h.admin.query(`select count(*)::int c from stock_receipt_costs where source_kind = 'supplier_receipt' and source_id = $1`, [receiptId])).rows[0].c).toBe(1);
    expect(await raw(`update supplier_receipts set quantity = 9 where id = $1`, [receiptId])).toBe("raw:42501");
    expect(await raw(`update supplier_receipts set delivery_note = 'SJ-UBAH' where id = $1`, [receiptId])).toBe("raw:42501");
    expect(await raw(`delete from supplier_receipts where id = $1`, [receiptId])).toBe("raw:42501");
    expect(await raw(`update supplier_returns set quantity = 2 where id = $1`, [returnId])).toBe("raw:42501");
    expect(await raw(`update supplier_returns set note = 'Alasan diubah' where id = $1`, [returnId])).toBe("raw:42501");
    expect(await raw(`delete from supplier_returns where id = $1`, [returnId])).toBe("raw:42501");
    // a raw receipt or return without its movement is refused
    expect(await raw(`insert into supplier_receipts (tenant_id, branch_id, supplier_id, batch_id, quantity, unit_cost, source_kind, source_id, received_by, received_as)
                      values ($1, $2, $3, $4, 100, 1, 'goods_receipt', gen_random_uuid(), $5, 'purchasing')`, [A.tenantId, A.b1, SUP, b, PUR.staffId])).toBe("raw:42501");
    const e = (await h.admin.query(`select id from supplier_credit_expectations where return_id = $1`, [returnId])).rows[0].id;
    expect(await raw(`update supplier_credit_expectations set amount = 1 where id = $1`, [e])).toBe("raw:42501");
    expect(await raw(`update supplier_credit_expectations set amount = 1, state = 'written_off', closed_reason = 'Ubah nilai', closed_by = $2, closed_as = 'finance', closed_at = now() where id = $1`, [e, FIN.staffId])).toBe("raw:42501");
    expect(await raw(`delete from supplier_credit_expectations where id = $1`, [e])).toBe("raw:42501");
    expect(await raw(`update supplier_credit_expectations set state = 'written_off', closed_reason = 'Pemasok tutup', closed_by = $2, closed_as = 'finance', closed_at = now() where id = $1`, [e, FIN.staffId])).toBe("ok");
    expect(await raw(`update supplier_credit_expectations set state = 'expected', closed_reason = null, closed_by = null, closed_as = null, closed_at = null where id = $1`, [e])).toBe("raw:42501");
    expect(await raw(`truncate supplier_returns`)).toMatch(/^raw:/);
    await h.admin.query("begin");
    try {
      await h.admin.query("set local session_replication_role = replica");
      expect(await code(h.admin.query(`delete from supplier_returns where id = $1`, [returnId]))).toBe("raw:42501");
    } finally {
      await h.admin.query("rollback");
    }
  });
});
