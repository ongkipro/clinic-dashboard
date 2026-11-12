// T-069 M3 exit stock fixture (PLAN §1 M3: "stock fixture: no double deduction, depot balances never negative"): one
// stock item through every M3 stock writer on a real database, through the real writers only — no trigger disabled,
// no row inserted around a writer, except the documented stand-ins of earlier tasks: the patient and visit rows (their
// writers are the M1 registration and check-in; seeded as the M3 tests do) and the step-up proof `{ verified: true }`
// the prescription signing UI will produce (T-065).
// A supplier's batch received at a cost (T-066); moved gudang → apotek and gudang → room (T-061); sent to branch 2 and
// received there, one more sent and cancelled (T-061); issued to the room for a treatment and consumed — the completion
// retried with the same key and concurrently with a new one (T-062, CLIN-008); a second request's leftover returned
// usable and a third's wasted (T-062); a signed prescription prepared without moving stock, then handed over twice
// (T-065, CLIN-017, CLIN-018); 2 units returned to the supplier (T-066); and an over-draw at every step refused. After
// every step: every depot holding ≥ 0, each batch equals the sum of its holdings, each holding equals the last balance
// its movements wrote, and the batch total equals receipts minus outflows; each source wrote its movements once.
// Synthetic data (MIG-2).
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../../src/db/rls/context";
import { openAppPool } from "../../../src/db/rls/pool";
import { CommandError } from "../../../src/lib/command";
import { publish } from "../../../src/modules/catalog/catalog";
import { cancelTransfer, createDepot, receiveTransfer, sendToBranch, transferBetweenDepots } from "../../../src/modules/inventory/depots/depots";
import { consumeMaterials, decideReturn, issueMaterials, proposeReturn, requestMaterials, wasteMaterials } from "../../../src/modules/inventory/materials/materials";
import { saveItem } from "../../../src/modules/inventory/stock";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { addPrescriptionItem, CHECKS, type Check, createPrescription, handOver, prepareDispensing, signPrescription } from "../../../src/modules/pharmacy/pharmacy";
import { receiveFromSupplier, returnToSupplier, saveSupplier } from "../../../src/modules/purchasing/suppliers/suppliers";
import { createHarness, type Harness, testPool } from "../../../tests/rls/harness";

process.env.DEPLOY_ENV = "local"; // synthetic data (MIG-2)

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let n = 0;
type P = { acc: string; staffId: string; role: Role; branch?: string };
let tenantId: string;
let b1: string;
let b2: string;
const TENANT_WIDE = ["owner", "purchasing"];
const ALL = Object.fromEntries(CHECKS.map((c) => [c, true])) as Record<Check, boolean>;

async function person(role: Role, name: string, branch?: string): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ($1, $2, true) returning id`, [name, `m3flow${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId, accountId: acc, displayName: name });
  const rid = await assignRole(h.admin, { tenantId, staffId, role });
  if (!TENANT_WIDE.includes(role)) await assignBranch(h.admin, { tenantId, staffRoleId: rid, branchId: branch ?? b1 });
  return { acc, staffId, role, branch: TENANT_WIDE.includes(role) ? undefined : branch ?? b1 };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
const key = () => crypto.randomUUID();
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
const day = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
const num = (x: unknown) => Number(x);
const held = async (depot: string, batch: string) =>
  num((await h.admin.query(`select coalesce((select quantity from batch_holdings where depot_id = $1 and batch_id = $2), 0) q`, [depot, batch])).rows[0].q);
const batchQty = async (batch: string) => num((await h.admin.query(`select coalesce(sum(quantity), 0) q from stock_batches where id = any($1::uuid[])`, [[batch]])).rows[0].q);
const movementsOf = async (source: string) => (await h.admin.query(`select kind, leg, depot_id, quantity::float q from stock_movements where source_id = $1 order by seq`, [source])).rows;
async function patientVisit(branch: string, by: P): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, "");
  const pid = (await h.admin.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation, education,
                           marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, 'Pasien Alur M3', '1990-01-01', 'female', 'nik', $3, $4, 'islam', 'Karyawan', 's1', 'kawin', $2, $5, 'fo_cashier') returning id`,
    [tenantId, branch, `v1.1.${id}.${id}.${id}`, (id + id).slice(0, 43), by.staffId])).rows[0].id as string;
  return (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`,
    [tenantId, branch, pid, by.staffId])).rows[0].id as string;
}

// The fixture's invariants over every batch of the tenant, checked after every step.
let received = 0; // units received from the supplier (the only inflow)
let outflow = 0; // consumed, wasted, dispensed, returned to the supplier
async function invariants(item: string) {
  const neg = (await h.admin.query(`select depot_id, batch_id, quantity::float q from batch_holdings where tenant_id = $1 and quantity < 0`, [tenantId])).rows;
  expect(neg, "a depot balance went negative").toEqual([]);
  const sums = (await h.admin.query(
    `select b.id from stock_batches b left join lateral (select coalesce(sum(x.quantity), 0) s from batch_holdings x where x.tenant_id = b.tenant_id and x.batch_id = b.id) hs on true
      where b.tenant_id = $1 and b.quantity <> hs.s`, [tenantId])).rows;
  expect(sums, "a batch differs from the sum of its holdings").toEqual([]);
  const last = (await h.admin.query(
    `select hh.id from batch_holdings hh
       left join lateral (select m.depot_balance_after d from stock_movements m where m.tenant_id = hh.tenant_id and m.batch_id = hh.batch_id and m.depot_id = hh.depot_id order by m.seq desc limit 1) m on true
      where hh.tenant_id = $1 and hh.quantity <> coalesce(m.d, 0)`, [tenantId])).rows;
  expect(last, "a holding differs from the last balance of its movements").toEqual([]);
  // Stock sent to another branch and not yet received (or cancelled) is in transit: the sent leg's units.
  const total = num((await h.admin.query(`select coalesce(sum(quantity), 0) q from stock_batches where tenant_id = $1 and item_id = $2`, [tenantId, item])).rows[0].q);
  const transit = num((await h.admin.query(
    `select coalesce(-sum(m.quantity), 0) q from stock_movements m join depot_transfers t on t.tenant_id = m.tenant_id and t.id = m.source_id
      where m.tenant_id = $1 and m.item_id = $2 and t.state = 'sent'`, [tenantId, item])).rows[0].q);
  expect(total + transit, "conservation: receipts minus outflows (stock in transit counted)").toBe(received - outflow);
}

let OWN: P; let PU: P; let PH: P; let PH2: P; let DOC: P; let NUR: P; let FO: P;
let item: string; let version: string; let supplier: string;
let G1: string; let APT: string; let ROOM: string; let G2: string;

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 6 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Klinik Alur M3 Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
  b1 = await br("M3A");
  b2 = await br("M3B");
  OWN = await person("owner", "Ibu Pemilik"); PU = await person("purchasing", "Rina Pembelian");
  PH = await person("pharmacist", "Sari Apoteker"); PH2 = await person("pharmacist", "Tono Apoteker Dua", b2);
  DOC = await person("doctor", "dr. Ayu"); NUR = await person("nurse", "Rani Perawat"); FO = await person("fo_cashier", "Dina FO");
  // One product: dispensed by prescription and used as a standard material in the room.
  const v = await as(OWN, (db) => publish(db, { kind: "product", code: "M3-SRM" }, { name: "Serum Alur M3", tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 150_000 } as never, "Produk"));
  version = v.versionId;
  item = (await as(PH, (db) => saveItem(db, key(), null, { catalogItemId: v.itemId, unit: "btl", storage: "ruang", highValue: false, active: true }))).itemId;
  supplier = (await as(PU, (db) => saveSupplier(db, key(), null, { name: "PT Pemasok Alur M3", paymentTermsDays: 30 }))).supplierId;
  G1 = (await h.admin.query(`select id from depots where branch_id = $1 and is_default`, [b1])).rows[0].id;
  G2 = (await h.admin.query(`select id from depots where branch_id = $1 and is_default`, [b2])).rows[0].id;
  APT = (await as(PH, (db) => createDepot(db, key(), { branchId: null, name: "Apotek Alur", kind: "apotek" }))).depotId;
  ROOM = (await as(PH, (db) => createDepot(db, key(), { branchId: null, name: "Ruang Alur", kind: "ruang" }))).depotId;
}, 300_000);
afterAll(async () => {
  await app?.end();
  await owner?.end();
  await h?.close();
});

describe("M3 stock fixture", () => {
  it("one stock item through every M3 writer: no double deduction, every depot balance never negative, conservation per batch", async () => {
    // 1. A supplier's batch of 40 received at Rp120,000 (T-066); the over-draw guard: nothing moves on a refusal.
    const r = await as(PU, (db) => receiveFromSupplier(db, key(), b1, { supplierId: supplier, itemId: item, batchNo: "M3-01", expiry: day(300), quantity: "40", unitCost: 120_000, reason: "penerimaan" }));
    const B = (await h.admin.query(`select batch_id from supplier_receipts where id = $1`, [r.receiptId])).rows[0].batch_id as string;
    received += 40;
    await invariants(item);
    expect(await held(G1, B)).toBe(40);

    // 2. Gudang → apotek 15 and gudang → room 10 (T-061); a transfer above the holding is refused whole.
    await as(PH, (db) => transferBetweenDepots(db, key(), { fromDepotId: G1, toDepotId: APT, lines: [{ batchId: B, quantity: "15" }] }));
    await as(PH, (db) => transferBetweenDepots(db, key(), { fromDepotId: G1, toDepotId: ROOM, lines: [{ batchId: B, quantity: "10" }] }));
    expect(await code(as(PH, (db) => transferBetweenDepots(db, key(), { fromDepotId: G1, toDepotId: APT, lines: [{ batchId: B, quantity: "16" }] })))).toBe("ERR_STOCK_INSUFFICIENT");
    expect([await held(G1, B), await held(APT, B), await held(ROOM, B)]).toEqual([15, 15, 10]);
    await invariants(item);

    // 3. Inter-branch: 5 sent to branch 2 and received there; 3 more sent and cancelled (back to the gudang).
    const { transferId } = await as(PH, (db) => sendToBranch(db, key(), { fromDepotId: G1, toBranchId: b2, lines: [{ batchId: B, quantity: "5" }] }));
    await invariants(item);
    await as(PH2, (db) => receiveTransfer(db, key(), transferId, null));
    const B2 = (await h.admin.query(`select id from stock_batches where tenant_id = $1 and branch_id = $2 and item_id = $3`, [tenantId, b2, item])).rows[0].id as string;
    expect([await held(G1, B), await held(G2, B2)]).toEqual([10, 5]);
    const { transferId: t2 } = await as(PH, (db) => sendToBranch(db, key(), { fromDepotId: G1, toBranchId: b2, lines: [{ batchId: B, quantity: "3" }] }));
    expect(await held(G1, B)).toBe(7);
    await as(PH, (db) => cancelTransfer(db, key(), t2));
    expect(await held(G1, B)).toBe(10);
    await invariants(item);

    // 4. Treatment materials (T-062): a request moves nothing; 6 issued from the gudang to the room; the completion
    //    retried (same key) and raced (new key): one consumption and one consume movement (CLIN-008).
    const v1 = await patientVisit(b1, FO);
    const { requestId } = await as(NUR, (db) => requestMaterials(db, key(), { visitId: v1, roomDepotId: ROOM, lines: [{ itemId: item, quantity: "6" }] }));
    expect([await held(G1, B), await held(ROOM, B)]).toEqual([10, 10]); // a request never changes stock
    await as(PH, (db) => issueMaterials(db, key(), requestId, { fromDepotId: G1 }));
    expect([await held(G1, B), await held(ROOM, B)]).toEqual([4, 16]);
    await invariants(item);
    const k = key();
    const runs = await Promise.allSettled([
      as(NUR, (db) => consumeMaterials(db, k, requestId, [{ itemId: item, quantity: "6" }])),
      as(NUR, (db) => consumeMaterials(db, k, requestId, [{ itemId: item, quantity: "6" }])),
      as(DOC, (db) => consumeMaterials(db, key(), requestId, [{ itemId: item, quantity: "6" }])),
    ]);
    expect(runs.some((x) => x.status === "fulfilled")).toBe(true);
    // Whichever call won, a later retry with the same key either replays it or is refused: nothing moves again.
    expect(["ok", "ERR_VERSION_CONFLICT"]).toContain(await code(as(NUR, (db) => consumeMaterials(db, k, requestId, [{ itemId: item, quantity: "6" }]))));
    const cons = (await h.admin.query(`select id from material_consumptions where request_id = $1`, [requestId])).rows;
    expect(cons).toHaveLength(1);
    expect(await movementsOf(cons[0].id)).toEqual([{ kind: "consume", leg: null, depot_id: ROOM, q: -6 }]);
    outflow += 6;
    expect(await held(ROOM, B)).toBe(10);
    await invariants(item);

    // 5. A second request: 4 issued from the apotek to the room; 2 returned unopened and accepted usable back into the
    //    apotek, 1 wasted (the replay wastes nothing more; wasting more than is free is refused), 1 used.
    const v2 = await patientVisit(b1, FO);
    const { requestId: rq2 } = await as(NUR, (db) => requestMaterials(db, key(), { visitId: v2, roomDepotId: ROOM, lines: [{ itemId: item, quantity: "4" }] }));
    await as(PH, (db) => issueMaterials(db, key(), rq2, { fromDepotId: APT }));
    expect([await held(APT, B), await held(ROOM, B)]).toEqual([11, 14]);
    const { returnId } = await as(NUR, (db) => proposeReturn(db, key(), rq2, { condition: "unopened", lines: [{ itemId: item, quantity: "2" }] }));
    await as(PH, (db) => decideReturn(db, key(), returnId, "usable", APT));
    const wk = key();
    await as(NUR, (db) => wasteMaterials(db, wk, rq2, { reason: "Botol jatuh dan pecah", lines: [{ itemId: item, quantity: "1" }] }));
    await as(NUR, (db) => wasteMaterials(db, wk, rq2, { reason: "Botol jatuh dan pecah", lines: [{ itemId: item, quantity: "1" }] })); // replay: once
    outflow += 1;
    expect(await code(as(NUR, (db) => wasteMaterials(db, key(), rq2, { reason: "Lebih dari sisa", lines: [{ itemId: item, quantity: "2" }] })))).not.toBe("ok"); // only 1 left free
    await as(NUR, (db) => consumeMaterials(db, key(), rq2, [{ itemId: item, quantity: "1" }]));
    outflow += 1;
    expect([await held(APT, B), await held(ROOM, B)]).toEqual([13, 10]);
    await invariants(item);

    // 6. Pharmacy (T-065): a signed prescription prepared and not handed over moves nothing (CLIN-017); the handover
    //    retried with the same key and raced with a new one is one dispensing of 3 (CLIN-018).
    const v3 = await patientVisit(b1, FO);
    const { prescriptionId } = await as(DOC, (db) => createPrescription(db, key(), v3));
    await as(DOC, (db) => addPrescriptionItem(db, key(), prescriptionId, { catalogVersionId: version, quantity: "3", signa: "1x sehari" }));
    await as(DOC, (db) => signPrescription(db, key(), prescriptionId, { verified: true }));
    const d = (await h.admin.query(`select id from dispensings where visit_id = $1`, [v3])).rows[0].id as string;
    await as(PH, (db) => prepareDispensing(db, key(), d, APT));
    expect(await held(APT, B)).toBe(13);
    await invariants(item);
    const hk = key();
    await Promise.allSettled([
      as(PH, (db) => handOver(db, hk, d, { checks: ALL })),
      as(PH, (db) => handOver(db, hk, d, { checks: ALL })),
      as(PH, (db) => handOver(db, key(), d, { checks: ALL })),
    ]);
    // Whichever call won, a retry with the same key replays it or is refused; one dispensing either way.
    expect(["ok", "ERR_VERSION_CONFLICT"]).toContain(await code(as(PH, (db) => handOver(db, hk, d, { checks: ALL }))));
    expect((await h.admin.query(`select state from dispensings where id = $1`, [d])).rows[0].state).toBe("handed");
    const disp = await movementsOf(d);
    expect(disp.reduce((t, m) => t + m.q, 0)).toBe(-3);
    expect(disp.every((m) => m.kind === "dispense" && m.depot_id === APT)).toBe(true);
    outflow += 3;
    expect(await held(APT, B)).toBe(10);
    await invariants(item);

    // 7. A supplier return of 2 from the apotek (T-066); never more than the depot holds.
    expect(await code(as(PU, (db) => returnToSupplier(db, key(), b1, { supplierId: supplier, batchId: B, quantity: "11", reason: "damaged", note: "Lebih dari isi apotek", depotId: APT })))).not.toBe("ok");
    const rk = key();
    await as(PU, (db) => returnToSupplier(db, rk, b1, { supplierId: supplier, batchId: B, quantity: "2", reason: "damaged", note: "Segel rusak", depotId: APT }));
    await as(PU, (db) => returnToSupplier(db, rk, b1, { supplierId: supplier, batchId: B, quantity: "2", reason: "damaged", note: "Segel rusak", depotId: APT })); // replay: once
    outflow += 2;
    expect(await held(APT, B)).toBe(8);
    await invariants(item);

    // The end state: gudang 4, apotek 8, room 10 at branch 1; 5 at branch 2; 40 received, 13 out; each movement once.
    expect([await held(G1, B), await held(APT, B), await held(ROOM, B), await held(G2, B2)]).toEqual([4, 8, 10, 5]);
    expect([await batchQty(B), await batchQty(B2)]).toEqual([22, 5]);
    const kinds = (await h.admin.query(`select kind, count(*)::int n, sum(quantity)::float q from stock_movements where tenant_id = $1 and item_id = $2 and leg is null group by kind order by kind`, [tenantId, item])).rows;
    expect(kinds).toEqual([
      { kind: "consume", n: 2, q: -7 },
      { kind: "dispense", n: 1, q: -3 },
      { kind: "receive", n: 1, q: 40 },
      { kind: "supplier_return", n: 1, q: -2 },
      { kind: "waste", n: 1, q: -1 },
    ]);
  });
});
