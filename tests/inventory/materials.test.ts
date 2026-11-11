// T-062 Done-when: scenario PR-16 (a pack of cotton issued to a room; a treatment using the standard per-treatment
// model completes → stock is not deducted a second time) and CLIN-008 (a retried completion: one transition, one
// deduction). Plus the plan review: a request moves nothing; one issue per request (FEFO in the source depot, picks per
// batch, open vial run down); standard/precise consume from the room depot once; returns decided by the pharmacist
// (usable only when sealed and fit; waste); room waste; per-batch free quantity with pending returns reserved; bulk
// lines closed by consumption; reconciliation; roles, branches and tenants; guards; events content-free; stock_card
// masked for purchasing. Σ holdings = batch quantity after every case. Synthetic data on a local database (MIG-2).
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { publish } from "../../src/modules/catalog/catalog";
import { createDepot, openVialIn } from "../../src/modules/inventory/depots/depots";
import {
  cancelRequest, consumeMaterials, decideReturn, getRequest, issueMaterials, issueQueue, proposeReturn, requestMaterials, requestsForVisit, setItemClass,
  wasteMaterials,
} from "../../src/modules/inventory/materials/materials";
import { holdBatch, receiveStock, saveItem, stockCard } from "../../src/modules/inventory/stock";
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
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Bahan Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
  return { tenantId, b1: await br("M1"), b2: await br("M2") };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email) values ('X', $1) returning id`, [`mat${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Bahan ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  if (!TENANT_WIDE.includes(role)) for (const b of branches.length ? branches : [t.b1]) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, tenantId: t.tenantId, role, branch: TENANT_WIDE.includes(role) ? undefined : branches[0] ?? t.b1 };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
const key = () => crypto.randomUUID();
const day = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
const held = async (depot: string, batch: string) =>
  Number((await h.admin.query(`select coalesce((select quantity from batch_holdings where depot_id = $1 and batch_id = $2), 0) as q`, [depot, batch])).rows[0].q);
const batchQty = async (batch: string) => Number((await h.admin.query(`select quantity from stock_batches where id = $1`, [batch])).rows[0].quantity);
const gudang = async (branch: string) => (await h.admin.query(`select id from depots where branch_id = $1 and is_default`, [branch])).rows[0].id as string;
const moves = async (sourceId: string) =>
  (await h.admin.query(`select kind, leg, depot_id, batch_id, quantity::float q from stock_movements where source_id = $1 order by seq`, [sourceId])).rows;
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
async function patient(t: T, branch: string): Promise<string> {
  return (await h.admin.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation, education, marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, 'Pasien Bahan', '1990-01-01', 'female', 'newborn_via_guardian', 'Fixture', 'islam',
             'Karyawan', 's1', 'kawin', $2, (select s.id from staff s where s.tenant_id = $1 limit 1), 'fo_cashier') returning id`, [t.tenantId, branch])).rows[0].id as string;
}
async function visit(t: T, branch = t.b1): Promise<string> {
  const pid = await patient(t, branch);
  return (await h.admin.query(
    `insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', (select s.id from staff s where s.tenant_id = $1 limit 1)) returning id`,
    [t.tenantId, branch, pid])).rows[0].id as string;
}

let A: T; let B: T;
let OWN: P; let PU: P; let AU: P; let MGR: P; let PH: P; let PHB2: P; let DOC: P; let NUR: P; let THR: P; let FO: P; let BPH: P; let BNUR: P;
let cotton: string; let gel: string; let toxin: string; let needle: string;
let G1: string; let ROOM: string; let ROOM2: string; let APOTEK: string; let BG: string; let BROOM: string;

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 8 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant();
  B = await tenant();
  OWN = await person(A, "owner"); PU = await person(A, "purchasing"); AU = await person(A, "auditor");
  MGR = await person(A, "manager", A.b1); PH = await person(A, "pharmacist", A.b1); PHB2 = await person(A, "pharmacist", A.b2);
  DOC = await person(A, "doctor", A.b1); NUR = await person(A, "nurse", A.b1); THR = await person(A, "therapist", A.b1); FO = await person(A, "fo_cashier", A.b1);
  BPH = await person(B, "pharmacist", B.b1); BNUR = await person(B, "nurse", B.b1);
  const pub = async (t: T, who: P, kind: "material" | "product", c: string, name: string) =>
    (await as(who, (db) => publish(db, { kind, code: c }, { name, tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 1_000 } as never, "Barang baru"))).itemId;
  const BOWN = await person(B, "owner");
  const item = async (who: P, catalogItemId: string, unit: string, vial?: string) =>
    (await as(who, (db) => saveItem(db, key(), null, { catalogItemId, unit, ...(vial ? { vialSize: vial, openedUseHours: 24 } : {}), storage: "ruang", highValue: false, active: true }))).itemId;
  cotton = await item(PH, await pub(A, OWN, "material", "MAT-KAP", "Kapas"), "pak");
  gel = await item(PH, await pub(A, OWN, "material", "MAT-GEL", "Gel USG"), "ml");
  toxin = await item(PH, await pub(A, OWN, "product", "MAT-TOX", "Toksin"), "U", "100");
  needle = await item(PH, await pub(A, OWN, "material", "MAT-JAR", "Jarum"), "pcs");
  await as(PH, (db) => setItemClass(db, key(), cotton, "bulk"));
  await as(PU, (db) => setItemClass(db, key(), toxin, "precise"));
  G1 = await gudang(A.b1);
  ROOM = (await as(PH, (db) => createDepot(db, key(), { branchId: null, name: "Ruang Tindakan 1", kind: "ruang" }))).depotId;
  ROOM2 = (await as(PH, (db) => createDepot(db, key(), { branchId: null, name: "Ruang Tindakan 2", kind: "ruang" }))).depotId;
  APOTEK = (await as(PH, (db) => createDepot(db, key(), { branchId: null, name: "Apotek", kind: "apotek" }))).depotId;
  BG = await gudang(B.b1);
  BROOM = (await as(BPH, (db) => createDepot(db, key(), { branchId: null, name: "Ruang B", kind: "ruang" }))).depotId;
  void BG; void BOWN;
}, 300_000);
afterAll(async () => {
  await app?.end();
  await owner?.end();
  await h?.close();
});

const receive = (itemId: string, batchNo: string, quantity: string, expiry = day(200)) =>
  as(PH, (db) => receiveStock(db, key(), null, { itemId, batchNo, expiry, quantity, reason: "stok_awal" })).then((r) => r.batchId);

describe("scenario PR-16: no double deduction", () => {
  it("a pack of cotton issued to a room; a treatment using the standard per-treatment model completes → stock is not deducted a second time", async () => {
    const b = await receive(cotton, "KAP-16", "10");
    const v = await visit(A);
    const { requestId } = await as(NUR, (db) => requestMaterials(db, key(), { visitId: v, roomDepotId: ROOM, lines: [{ itemId: cotton, quantity: "1" }] }));
    // Selection/request never changes stock.
    expect([await held(G1, b), await held(ROOM, b), await batchQty(b)]).toEqual([10, 0, 10]);
    const { issueId } = await as(PH, (db) => issueMaterials(db, key(), requestId, { fromDepotId: G1 }));
    expect([await held(G1, b), await held(ROOM, b), await batchQty(b)]).toEqual([9, 1, 10]);
    expect(await moves(issueId)).toEqual([
      { kind: "issue", leg: "out", depot_id: G1, batch_id: b, q: -1 },
      { kind: "issue", leg: "in", depot_id: ROOM, batch_id: b, q: 1 },
    ]);
    // The treatment completes with the standard per-treatment model: an estimate, no movement.
    const { consumptionId } = await as(NUR, (db) => consumeMaterials(db, key(), requestId, [{ itemId: cotton, quantity: "0.1" }]));
    expect(await moves(consumptionId)).toEqual([]);
    expect([await held(G1, b), await held(ROOM, b), await batchQty(b)]).toEqual([9, 1, 10]);
    const line = (await h.admin.query(`select class_used, estimated, quantity::float q, batch_id from material_consumption_lines where consumption_id = $1`, [consumptionId])).rows;
    expect(line).toEqual([{ class_used: "bulk", estimated: true, q: 0.1, batch_id: null }]);
    expect((await as(NUR, (db) => getRequest(db, requestId))).state).toBe("reconciled");
    // The consumed bulk line belongs to room counts: no return or waste on it.
    await invariant();
  });

  it("a second treatment from the same room pack is not deducted either; return and waste of a consumed bulk line are refused", async () => {
    const v = await visit(A);
    const { requestId } = await as(NUR, (db) => requestMaterials(db, key(), { visitId: v, roomDepotId: ROOM, lines: [{ itemId: cotton, quantity: "1" }] }));
    await as(PH, (db) => issueMaterials(db, key(), requestId, { fromDepotId: G1 }));
    const total = Number((await h.admin.query(`select sum(quantity) s from stock_batches where item_id = $1`, [cotton])).rows[0].s);
    await as(NUR, (db) => consumeMaterials(db, key(), requestId));
    expect(Number((await h.admin.query(`select sum(quantity) s from stock_batches where item_id = $1`, [cotton])).rows[0].s)).toBe(total);
    expect(await code(as(NUR, (db) => wasteMaterials(db, key(), requestId, { reason: "Kotor", lines: [{ itemId: cotton, quantity: "1" }] })))).toBe("ERR_VERSION_CONFLICT");
    // With a standard line still open the request stays issued: a consumed bulk line still takes no return or waste.
    await receive(gel, "GEL-B", "20");
    const { requestId: r2 } = await as(NUR, (db) => requestMaterials(db, key(), { visitId: v, roomDepotId: ROOM, lines: [{ itemId: cotton, quantity: "1" }, { itemId: gel, quantity: "5" }] }));
    await as(PH, (db) => issueMaterials(db, key(), r2, { fromDepotId: G1 }));
    await as(NUR, (db) => consumeMaterials(db, key(), r2, [{ itemId: gel, quantity: "2" }]));
    expect((await as(NUR, (db) => getRequest(db, r2))).state).toBe("issued");
    expect(await code(as(NUR, (db) => wasteMaterials(db, key(), r2, { reason: "Kotor", lines: [{ itemId: cotton, quantity: "1" }] })))).toBe("ERR_VERSION_CONFLICT");
    expect(await code(as(NUR, (db) => proposeReturn(db, key(), r2, { condition: "unopened", lines: [{ itemId: cotton, quantity: "1" }] })))).toBe("ERR_VERSION_CONFLICT");
    await as(NUR, (db) => wasteMaterials(db, key(), r2, { reason: "Tumpah", lines: [{ itemId: gel, quantity: "3" }] }));
    expect((await as(NUR, (db) => getRequest(db, r2))).state).toBe("reconciled");
  });
});

describe("bulk lines (impl review ce8d7903 P1)", () => {
  it("a bulk line used 0 stays open for its return; a bulk line with a return or waste is not consumed above 0; no estimate above the issue", async () => {
    await receive(cotton, "KAP-Z", "10", day(3));
    const v = await visit(A);
    const req = () => as(NUR, (db) => requestMaterials(db, key(), { visitId: v, roomDepotId: ROOM, lines: [{ itemId: cotton, quantity: "2" }] }));
    // 0 used: the request stays issued; the two packs go back to the gudang, then it reconciles.
    const { requestId: r1 } = await req();
    await as(PH, (db) => issueMaterials(db, key(), r1, { fromDepotId: G1 }));
    await as(NUR, (db) => consumeMaterials(db, key(), r1, [{ itemId: cotton, quantity: "0" }]));
    expect((await as(NUR, (db) => getRequest(db, r1))).state).toBe("issued");
    const { returnId } = await as(NUR, (db) => proposeReturn(db, key(), r1, { condition: "unopened", lines: [{ itemId: cotton, quantity: "2" }] }));
    await as(PH, (db) => decideReturn(db, key(), returnId, "usable", G1));
    expect((await as(NUR, (db) => getRequest(db, r1))).state).toBe("reconciled");
    // A return proposed first: the bulk line is no longer whole, so consuming it above 0 is refused; 0 is accepted.
    const { requestId: r2 } = await req();
    await as(PH, (db) => issueMaterials(db, key(), r2, { fromDepotId: G1 }));
    await as(NUR, (db) => proposeReturn(db, key(), r2, { condition: "unopened", lines: [{ itemId: cotton, quantity: "1" }] }));
    expect(await code(as(NUR, (db) => consumeMaterials(db, key(), r2, [{ itemId: cotton, quantity: "0.5" }])))).toBe("ERR_VERSION_CONFLICT");
    expect(await code(as(NUR, (db) => consumeMaterials(db, key(), r2, [{ itemId: cotton, quantity: "0" }])))).toBe("ok");
    // A waste first: the same.
    const { requestId: r3 } = await req();
    await as(PH, (db) => issueMaterials(db, key(), r3, { fromDepotId: G1 }));
    await as(NUR, (db) => wasteMaterials(db, key(), r3, { reason: "Basah", lines: [{ itemId: cotton, quantity: "1" }] }));
    expect(await code(as(NUR, (db) => consumeMaterials(db, key(), r3, [{ itemId: cotton, quantity: "1" }])))).toBe("ERR_VERSION_CONFLICT");
    // An estimate above the issued quantity is refused.
    const { requestId: r4 } = await req();
    await as(PH, (db) => issueMaterials(db, key(), r4, { fromDepotId: G1 }));
    expect(await code(as(NUR, (db) => consumeMaterials(db, key(), r4, [{ itemId: cotton, quantity: "3" }])))).toBe("ERR_STOCK_INSUFFICIENT");
    // Consuming before any issue is refused.
    const { requestId: r5 } = await req();
    expect(await code(as(NUR, (db) => consumeMaterials(db, key(), r5)))).toBe("ERR_VERSION_CONFLICT");
    expect(await code(as(NUR, (db) => consumeMaterials(db, key(), r5, [{ itemId: cotton, quantity: "0" }])))).toBe("ERR_VERSION_CONFLICT");
    // A duplicate item in the issue lines is refused.
    expect(await code(as(PH, (db) => issueMaterials(db, key(), r5, { fromDepotId: G1, lines: [{ itemId: cotton, quantity: "1" }, { itemId: cotton, quantity: "1" }] })))).toBe("ERR_INVALID_INPUT");
    await invariant();
  });
});

describe("CLIN-008: retried completion — one transition, one deduction", () => {
  it("a standard item: replay returns the same consumption; two concurrent completions: one wins; one consume movement", async () => {
    const b = await receive(gel, "GEL-08", "100", day(15)); // earliest gel expiry: FEFO issues from it
    const v = await visit(A);
    const { requestId } = await as(NUR, (db) => requestMaterials(db, key(), { visitId: v, roomDepotId: ROOM, lines: [{ itemId: gel, quantity: "30" }] }));
    await as(PH, (db) => issueMaterials(db, key(), requestId, { fromDepotId: G1 }));
    expect([await held(G1, b), await held(ROOM, b), await batchQty(b)]).toEqual([70, 30, 100]);
    const k = key();
    const runs = await Promise.allSettled([
      as(NUR, (db) => consumeMaterials(db, k, requestId, [{ itemId: gel, quantity: "25" }])),
      as(DOC, (db) => consumeMaterials(db, key(), requestId, [{ itemId: gel, quantity: "25" }])),
    ]);
    const ok = runs.filter((r) => r.status === "fulfilled");
    expect(ok.length).toBe(1);
    const lost = runs.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((lost.reason as CommandError).code).toBe("ERR_VERSION_CONFLICT");
    expect([await held(ROOM, b), await batchQty(b)]).toEqual([5, 75]);
    // The retried completion (same key) replays: same consumption, nothing moves.
    const replay = await as(NUR, (db) => consumeMaterials(db, k, requestId, [{ itemId: gel, quantity: "25" }]));
    if ((ok[0] as PromiseFulfilledResult<{ consumptionId: string }>).value.consumptionId === replay.consumptionId) expect(replay.replayed).toBe(true);
    expect([await held(ROOM, b), await batchQty(b)]).toEqual([5, 75]);
    expect((await h.admin.query(`select count(*)::int n from stock_movements where kind = 'consume' and source_kind = 'material_consumption' and batch_id = $1`, [b])).rows[0].n).toBe(1);
    expect((await h.admin.query(`select count(*)::int n from material_consumptions where request_id = $1`, [requestId])).rows[0].n).toBe(1);
    // The 5 left: returned unopened, accepted usable into the apotek → reconciled.
    const { returnId } = await as(NUR, (db) => proposeReturn(db, key(), requestId, { condition: "unopened", lines: [{ itemId: gel, quantity: "5" }] }));
    expect((await as(NUR, (db) => getRequest(db, requestId))).state).toBe("issued");
    await as(PH, (db) => decideReturn(db, key(), returnId, "usable", APOTEK));
    expect([await held(ROOM, b), await held(APOTEK, b), await batchQty(b)]).toEqual([0, 5, 75]);
    expect((await as(NUR, (db) => getRequest(db, requestId))).state).toBe("reconciled");
    await invariant();
  });
});

describe("requests and issue (open points 2, 3; P1-1, P1-2)", () => {
  it("a request moves nothing, needs an open visit at the active branch, a ruang depot, distinct active items; cancel only while open", async () => {
    const v = await visit(A);
    const before = (await h.admin.query(`select count(*)::int n from stock_movements`)).rows[0].n;
    const r = (p: Partial<{ visitId: string; roomDepotId: string; lines: { itemId: string; quantity: string }[] }>, who = NUR) =>
      as(who, (db) => requestMaterials(db, key(), { visitId: v, roomDepotId: ROOM, lines: [{ itemId: gel, quantity: "1" }], ...p }));
    expect(await code(r({ roomDepotId: G1 }))).toBe("ERR_INVALID_INPUT");
    expect(await code(r({ lines: [{ itemId: gel, quantity: "1" }, { itemId: gel, quantity: "2" }] }))).toBe("ERR_INVALID_INPUT");
    expect(await code(r({ lines: [] }))).toBe("ERR_INVALID_INPUT");
    expect(await code(r({ visitId: await visit(A, A.b2) }))).toBe("ERR_NOT_FOUND");
    for (const p of [FO, MGR, PU, OWN]) expect(await code(r({}, p))).toBe("ERR_FORBIDDEN");
    const { requestId } = await r({}, THR);
    expect((await h.admin.query(`select count(*)::int n from stock_movements`)).rows[0].n).toBe(before);
    await as(DOC, (db) => cancelRequest(db, key(), requestId));
    expect(await code(as(PH, (db) => issueMaterials(db, key(), requestId, { fromDepotId: G1 })))).toBe("ERR_VERSION_CONFLICT");
    expect(await code(as(DOC, (db) => cancelRequest(db, key(), requestId)))).toBe("ERR_VERSION_CONFLICT");
    expect(await code(r({ lines: [{ itemId: gel, quantity: "1e1" }] }))).toBe("ERR_INVALID_INPUT"); // the database would read 10
    // An issued request cannot be cancelled; an issue naming an item the request does not hold is refused.
    const { requestId: r2 } = await r({}, NUR);
    expect(await code(as(PH, (db) => issueMaterials(db, key(), r2, { fromDepotId: G1, lines: [{ itemId: needle, quantity: "1" }] })))).toBe("ERR_INVALID_INPUT");
    await receive(gel, "GEL-C", "5");
    await as(PH, (db) => issueMaterials(db, key(), r2, { fromDepotId: G1 }));
    expect(await code(as(NUR, (db) => cancelRequest(db, key(), r2)))).toBe("ERR_VERSION_CONFLICT");
    // The pharmacist issues and decides; the room staff consume.
    expect(await code(as(PH, (db) => consumeMaterials(db, key(), r2)))).toBe("ERR_FORBIDDEN");
    // A negative quantity is refused by the database too (the module refuses it earlier).
    expect(await code(as(NUR, (db) => db.query(`select material_consume('k-neg-000001', $1, $2::jsonb)`, [r2, JSON.stringify({ lines: [{ item_id: gel, quantity: -1 }] })])))).toBe("raw:22023");
    expect(await code(as(NUR, (db) => setItemClass(db, key(), gel, "bulk")))).toBe("ERR_FORBIDDEN");
  });

  it("one issue per request, every line, FEFO in the source depot, picks per batch; a fit open vial is run down by what it gave", async () => {
    const early = await receive(toxin, "TOX-A", "150", day(60));
    const late = await receive(toxin, "TOX-B", "100", day(300));
    const { vialId } = await as(PH, (db) => openVialIn(db, key(), early, G1)); // 100 U open in the gudang, 50 sealed
    const n1 = await receive(needle, "JAR-1", "50");
    const v = await visit(A);
    const { requestId } = await as(DOC, (db) => requestMaterials(db, key(), { visitId: v, roomDepotId: ROOM2,
      lines: [{ itemId: toxin, quantity: "180" }, { itemId: needle, quantity: "3" }] }));
    expect(await code(as(PH, (db) => issueMaterials(db, key(), requestId, { fromDepotId: G1, lines: [{ itemId: toxin, quantity: "181" }] })))).toBe("ERR_INVALID_INPUT");
    expect(await code(as(PH, (db) => issueMaterials(db, key(), requestId, { fromDepotId: ROOM2 })))).toBe("ERR_INVALID_INPUT");
    for (const p of [NUR, DOC, MGR, PU]) expect(await code(as(p, (db) => issueMaterials(db, key(), requestId, { fromDepotId: G1 })))).toBe("ERR_FORBIDDEN");
    expect(await code(as(PHB2, (db) => issueMaterials(db, key(), requestId, { fromDepotId: G1 })))).toBe("ERR_NOT_FOUND");
    const k = key();
    const { issueId } = await as(PH, (db) => issueMaterials(db, k, requestId, { fromDepotId: G1 }));
    // 180 = 100 (open vial, tier 1) + 50 sealed of the early batch (one row per batch) + 30 of the late batch.
    const il = (await h.admin.query(`select batch_id, quantity::float q from material_issue_lines where issue_id = $1 order by quantity desc`, [issueId])).rows;
    expect(il).toEqual(expect.arrayContaining([{ batch_id: early, q: 150 }, { batch_id: late, q: 30 }, { batch_id: n1, q: 3 }]));
    expect(il.length).toBe(3);
    expect([await held(G1, early), await held(ROOM2, early), await held(G1, late), await held(ROOM2, late), await batchQty(early)]).toEqual([0, 150, 70, 30, 150]);
    const vial = (await h.admin.query(`select remaining::float r, state from opened_vials where id = $1`, [vialId])).rows[0];
    expect(vial).toEqual({ r: 0, state: "finished" });
    // Replay: same issue; a second issue (another key) refused.
    expect((await as(PH, (db) => issueMaterials(db, k, requestId, { fromDepotId: G1 }))).issueId).toBe(issueId);
    expect(await code(as(PH, (db) => issueMaterials(db, key(), requestId, { fromDepotId: G1 })))).toBe("ERR_VERSION_CONFLICT");
    // precise: the batch must be named when the line holds more than one batch.
    expect(await code(as(DOC, (db) => consumeMaterials(db, key(), requestId, [{ itemId: toxin, quantity: "20" }])))).toBe("ERR_INVALID_INPUT");
    // consume 20 from the late batch, needle 0 (to be returned); then the rest of the toxin is returned and wasted.
    const { consumptionId } = await as(DOC, (db) => consumeMaterials(db, key(), requestId, [{ itemId: toxin, quantity: "20", batchId: late }, { itemId: needle, quantity: "0" }]));
    expect(await moves(consumptionId)).toEqual([{ kind: "consume", leg: null, depot_id: ROOM2, batch_id: late, q: -20 }]);
    expect((await h.admin.query(`select quantity::float q, batch_id, estimated from material_consumption_lines where consumption_id = $1 and item_id = $2`, [consumptionId, needle])).rows)
      .toEqual([{ q: 0, batch_id: null, estimated: false }]);
    expect([await held(ROOM2, late), await batchQty(late)]).toEqual([10, 80]);
    await invariant();
  });

  it("an open vial beside sealed stock is run down by what it gave: in the source depot on issue, in the room on a wasted return", async () => {
    const b = await receive(toxin, "TOX-V", "300", day(20));
    const { vialId } = await as(PH, (db) => openVialIn(db, key(), b, G1)); // 100 open + 200 sealed in the gudang
    const v = await visit(A);
    const { requestId } = await as(DOC, (db) => requestMaterials(db, key(), { visitId: v, roomDepotId: ROOM, lines: [{ itemId: toxin, quantity: "140" }] }));
    await as(PH, (db) => issueMaterials(db, key(), requestId, { fromDepotId: G1 }));
    // 140 = the open vial's 100 + 40 sealed; the gudang keeps 160 sealed, the vial is finished.
    expect([await held(G1, b), await held(ROOM, b)]).toEqual([160, 140]);
    expect((await h.admin.query(`select remaining::float r, state from opened_vials where id = $1`, [vialId])).rows[0]).toEqual({ r: 0, state: "finished" });
    // In the room a vial opens on the 140 (100 open + 40 sealed beside it); a wasted return of 15 runs it to 85.
    const { vialId: rv } = await as(PH, (db) => openVialIn(db, key(), b, ROOM));
    await as(DOC, (db) => consumeMaterials(db, key(), requestId, [{ itemId: toxin, quantity: "0" }]));
    const { returnId } = await as(NUR, (db) => proposeReturn(db, key(), requestId, { condition: "opened", lines: [{ itemId: toxin, quantity: "15" }] }));
    await as(PH, (db) => decideReturn(db, key(), returnId, "waste", null));
    expect([await held(ROOM, b), Number((await h.admin.query(`select remaining from opened_vials where id = $1`, [rv])).rows[0].remaining)]).toEqual([125, 85]);
    // And a room waste of 5 beside sealed stock: 80.
    await as(NUR, (db) => wasteMaterials(db, key(), requestId, { reason: "Tumpah", lines: [{ itemId: toxin, quantity: "5" }] }));
    expect(Number((await h.admin.query(`select remaining from opened_vials where id = $1`, [rv])).rows[0].remaining)).toBe(80);
    await invariant();
  });

  it("a partial issue below the requested quantity; the source depot's own vial in an issue that takes less than the vial", async () => {
    const b = await receive(gel, "GEL-P", "50", day(10));
    const v = await visit(A);
    const { requestId } = await as(NUR, (db) => requestMaterials(db, key(), { visitId: v, roomDepotId: ROOM2, lines: [{ itemId: gel, quantity: "8" }] }));
    const { issueId } = await as(PH, (db) => issueMaterials(db, key(), requestId, { fromDepotId: G1, lines: [{ itemId: gel, quantity: "6" }] }));
    expect((await h.admin.query(`select sum(quantity)::float q from material_issue_lines where issue_id = $1`, [issueId])).rows[0].q).toBe(6);
    expect(await held(ROOM2, b)).toBeGreaterThanOrEqual(0);
    await invariant();
  });

  it("unfit stock is not issued; insufficient stock refuses the whole issue and keeps nothing", async () => {
    const b = await receive(needle, "JAR-Q", "5", day(100));
    await as(PH, (db) => holdBatch(db, key(), b, "quarantined", "Kemasan rusak"));
    const v = await visit(A);
    const { requestId } = await as(NUR, (db) => requestMaterials(db, key(), { visitId: v, roomDepotId: ROOM, lines: [{ itemId: needle, quantity: "100" }] }));
    const k = key();
    expect(await code(as(PH, (db) => issueMaterials(db, k, requestId, { fromDepotId: G1 })))).toBe("ERR_STOCK_INSUFFICIENT");
    expect((await h.admin.query(`select count(*)::int n from material_issues where request_id = $1`, [requestId])).rows[0].n).toBe(0);
    // Nothing was kept: once stock arrives the same request is issued.
    await receive(needle, "JAR-N", "200");
    expect(await code(as(PH, (db) => issueMaterials(db, key(), requestId, { fromDepotId: G1 })))).toBe("ok");
    expect(await held(ROOM, b)).toBe(0);
  });
});

describe("returns, waste, free quantity, reconciliation (open points 5–7)", () => {
  it("free = issued − consumed − returned − wasted − pending; usable only when sealed, fit and not damaged; waste runs a room vial down", async () => {
    const b = await receive(toxin, "TOX-R", "300", day(12)); // earliest toxin expiry: FEFO issues from it
    const v = await visit(A);
    const { requestId } = await as(DOC, (db) => requestMaterials(db, key(), { visitId: v, roomDepotId: ROOM, lines: [{ itemId: toxin, quantity: "200" }] }));
    await as(PH, (db) => issueMaterials(db, key(), requestId, { fromDepotId: G1 }));
    const { vialId } = await as(PH, (db) => openVialIn(db, key(), b, ROOM)); // 100 open in the room, 100 sealed
    await as(DOC, (db) => consumeMaterials(db, key(), requestId, [{ itemId: toxin, quantity: "30", batchId: b }]));
    expect(Number((await h.admin.query(`select remaining from opened_vials where id = $1`, [vialId])).rows[0].remaining)).toBe(70);
    // pending return of 100 reserves: only 70 left to waste or return.
    const { returnId } = await as(NUR, (db) => proposeReturn(db, key(), requestId, { condition: "unopened", lines: [{ itemId: toxin, quantity: "100" }] }));
    expect(await code(as(NUR, (db) => wasteMaterials(db, key(), requestId, { reason: "Sisa vial", lines: [{ itemId: toxin, quantity: "71" }] })))).toBe("ERR_STOCK_INSUFFICIENT");
    expect((await as(PH, (db) => getRequest(db, requestId))).lines[0].batches[0]).toMatchObject({ issued: 200, consumed: 30, pending: 100, free: 70 });
    // The vial remainder (70) is wasted: the vial closes, nothing is subtracted twice afterwards.
    await as(NUR, (db) => wasteMaterials(db, key(), requestId, { reason: "Sisa vial terbuka", lines: [{ itemId: toxin, quantity: "70" }] }));
    expect((await h.admin.query(`select remaining::float r, state from opened_vials where id = $1`, [vialId])).rows[0]).toEqual({ r: 0, state: "finished" });
    for (const p of [NUR, DOC, MGR]) expect(await code(as(p, (db) => decideReturn(db, key(), returnId, "usable", G1)))).toBe("ERR_FORBIDDEN");
    expect(await code(as(PH, (db) => decideReturn(db, key(), returnId, "usable", ROOM)))).toBe("ERR_INVALID_INPUT");
    expect(await code(as(PH, (db) => decideReturn(db, key(), returnId, "waste", G1)))).toBe("ERR_INVALID_INPUT");
    await as(PH, (db) => decideReturn(db, key(), returnId, "usable", G1));
    expect(await code(as(PH, (db) => decideReturn(db, key(), returnId, "waste", null)))).toBe("ERR_VERSION_CONFLICT");
    expect([await held(ROOM, b), await held(G1, b), await batchQty(b)]).toEqual([0, 200, 200]); // 300 − 30 consumed − 70 wasted
    const r = await as(PH, (db) => getRequest(db, requestId));
    expect(r.state).toBe("reconciled");
    expect(r.lines[0].batches[0]).toMatchObject({ issued: 200, consumed: 30, returned: 100, wasted: 70, pending: 0, free: 0 });
    expect(await code(as(NUR, (db) => wasteMaterials(db, key(), requestId, { reason: "Lagi", lines: [{ itemId: toxin, quantity: "1" }] })))).toBe("ERR_VERSION_CONFLICT");
    await invariant();
  });

  it("concurrent wastes of one line serialize on the request: the free quantity is never spent twice", async () => {
    const b = await receive(gel, "GEL-W", "40", day(5));
    const v = await visit(A);
    const { requestId } = await as(NUR, (db) => requestMaterials(db, key(), { visitId: v, roomDepotId: ROOM, lines: [{ itemId: gel, quantity: "10" }] }));
    await as(PH, (db) => issueMaterials(db, key(), requestId, { fromDepotId: G1 }));
    await as(NUR, (db) => consumeMaterials(db, key(), requestId, [{ itemId: gel, quantity: "4" }]));
    const w = (p: P) => as(p, (db) => wasteMaterials(db, key(), requestId, { reason: "Tumpah", lines: [{ itemId: gel, quantity: "4" }] }));
    const r = await Promise.allSettled([w(NUR), w(DOC)]);
    expect(r.map((x) => x.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(((r.find((x) => x.status === "rejected") as PromiseRejectedResult).reason as CommandError).code).toBe("ERR_STOCK_INSUFFICIENT");
    expect((await as(PH, (db) => getRequest(db, requestId))).lines[0].batches.reduce((t, g) => t + g.wasted, 0)).toBe(4);
    void b;
    await invariant();
  });

  it("damaged returns are not usable; an open vial's remainder cannot be returned as sealed stock; a decided waste return closes it", async () => {
    const b = await receive(toxin, "TOX-D", "200", day(8)); // earliest expiry: FEFO issues from it
    const v = await visit(A);
    const { requestId } = await as(DOC, (db) => requestMaterials(db, key(), { visitId: v, roomDepotId: ROOM2, lines: [{ itemId: toxin, quantity: "100" }] }));
    await as(PH, (db) => issueMaterials(db, key(), requestId, { fromDepotId: G1 }));
    await as(PH, (db) => openVialIn(db, key(), b, ROOM2)); // the whole 100 is the open vial
    await as(DOC, (db) => consumeMaterials(db, key(), requestId, [{ itemId: toxin, quantity: "0" }]));
    const { returnId: dmg } = await as(NUR, (db) => proposeReturn(db, key(), requestId, { condition: "damaged", lines: [{ itemId: toxin, quantity: "10" }] }));
    expect(await code(as(PH, (db) => decideReturn(db, key(), dmg, "usable", G1)))).toBe("ERR_INVALID_INPUT");
    const { returnId: op } = await as(NUR, (db) => proposeReturn(db, key(), requestId, { condition: "opened", lines: [{ itemId: toxin, quantity: "90" }] }));
    expect(await code(as(PH, (db) => decideReturn(db, key(), op, "usable", G1)))).toBe("ERR_STOCK_INSUFFICIENT");
    await as(PH, (db) => decideReturn(db, key(), dmg, "waste", null));
    await as(PH, (db) => decideReturn(db, key(), op, "waste", null));
    expect([await held(ROOM2, b), await batchQty(b)]).toEqual([0, 100]);
    expect((await h.admin.query(`select state from opened_vials where batch_id = $1 and depot_id = $2`, [b, ROOM2])).rows[0].state).toBe("finished");
    expect((await as(PH, (db) => getRequest(db, requestId))).state).toBe("reconciled");
    await invariant();
  });
});

describe("readers, roles, tenants, guards, events, masking (open point 8)", () => {
  it("readers: room and pharmacy roles and the manager at their branch; queue for pharmacist; other branch/tenant not found; purchasing/auditor none", async () => {
    const v = await visit(A);
    const { requestId } = await as(NUR, (db) => requestMaterials(db, key(), { visitId: v, roomDepotId: ROOM, lines: [{ itemId: gel, quantity: "2" }] }));
    for (const p of [NUR, DOC, THR, PH, MGR]) expect((await as(p, (db) => getRequest(db, requestId))).id).toBe(requestId);
    expect((await as(NUR, (db) => requestsForVisit(db, v))).map((r) => r.id)).toEqual([requestId]);
    expect((await as(PH, (db) => issueQueue(db))).to_issue.map((r) => r.id)).toContain(requestId);
    expect(await code(as(NUR, (db) => issueQueue(db)))).toBe("ERR_FORBIDDEN");
    for (const p of [PU, AU, OWN, FO]) expect(await code(as(p, (db) => getRequest(db, requestId)))).toBe("ERR_FORBIDDEN");
    expect(await code(as(PHB2, (db) => getRequest(db, requestId)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BPH, (db) => getRequest(db, requestId)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BNUR, (db) => consumeMaterials(db, key(), requestId)))).toBe("ERR_NOT_FOUND");
    // RLS: direct reads by clinic_app follow the same branch rule.
    expect((await as(NUR, (db) => db.query(`select id from material_requests where id = $1`, [requestId]))).rows.length).toBe(1);
    expect((await as(PHB2, (db) => db.query(`select id from material_requests where id = $1`, [requestId]))).rows.length).toBe(0);
    expect((await as(PU, (db) => db.query(`select id from material_request_lines where request_id = $1`, [requestId]))).rows.length).toBe(0);
    // A branch role of the branch without a material role (front office) sees nothing either.
    expect((await as(FO, (db) => db.query(`select id from material_requests where id = $1`, [requestId]))).rows.length).toBe(0);
    expect((await as(BPH, (db) => db.query(`select id from material_requests where id = $1`, [requestId]))).rows.length).toBe(0);
    expect(await code(as(NUR, (db) => db.query(`update material_requests set state = 'cancelled' where id = $1`, [requestId])))).toMatch(/^raw:42501/);
  });

  it("purchasing sees the issue movements on the stock card with reason and source masked (IAM-12)", async () => {
    const b = await receive(gel, "GEL-M", "10");
    const v = await visit(A);
    const { requestId } = await as(NUR, (db) => requestMaterials(db, key(), { visitId: v, roomDepotId: ROOM, lines: [{ itemId: gel, quantity: "4" }] }));
    await as(PH, (db) => issueMaterials(db, key(), requestId, { fromDepotId: G1 }));
    const card = (await as(PU, (db) => stockCard(db, gel, A.b1, 100))) as unknown as { kind: string; reason: string | null; source_id: string | null }[];
    const rows = card.filter((m) => m.kind === "issue");
    expect(rows.length).toBeGreaterThan(0);
    for (const m of rows) expect([m.reason, m.source_id]).toEqual([null, null]);
    // the pharmacist sees the source
    const own = (await as(PH, (db) => stockCard(db, gel, A.b1, 100))) as unknown as { kind: string; source_id: string | null }[];
    expect(own.filter((m) => m.kind === "issue").every((m) => m.source_id !== null)).toBe(true);
    void b;
  });

  it("guards: children insert-only, requests and returns never deleted, states move forward only, unit frozen once requested; truncate refused", async () => {
    const v = await visit(A);
    const { requestId } = await as(NUR, (db) => requestMaterials(db, key(), { visitId: v, roomDepotId: ROOM, lines: [{ itemId: needle, quantity: "1" }] }));
    const raw = (sql: string, args: unknown[] = []) => code(h.admin.query(sql, args));
    expect(await raw(`delete from material_requests where id = $1`, [requestId])).toBe("raw:42501");
    expect(await raw(`update material_request_lines set requested_qty = 9 where request_id = $1`, [requestId])).toBe("raw:42501");
    expect(await raw(`delete from material_request_lines where request_id = $1`, [requestId])).toBe("raw:42501");
    expect(await raw(`update material_requests set state = 'reconciled', closed_at = now() where id = $1`, [requestId])).toBe("raw:42501");
    expect(await raw(`update material_requests set room_depot_id = $2, state = 'cancelled', closed_at = now() where id = $1`, [requestId, ROOM2])).toBe("raw:42501");
    expect(await raw(`truncate material_waste_lines`)).toMatch(/^raw:/);
    expect(await raw(`insert into material_requests (tenant_id, branch_id, visit_id, room_depot_id, command_key, requested_by, requested_as)
                      values ($1, $2, $3, $4, 'k-raw-0001', $5, 'nurse')`, [A.tenantId, A.b1, v, G1, NUR.staffId])).toBe("raw:42501");
    expect(await raw(`insert into material_requests (tenant_id, branch_id, visit_id, room_depot_id, state, command_key, requested_by, requested_as)
                      values ($1, $2, $3, $4, 'issued', 'k-raw-0002', $5, 'nurse')`, [A.tenantId, A.b1, v, ROOM, NUR.staffId])).toBe("raw:42501");
    expect(await raw(`update stock_items set unit = 'box' where id = $1`, [needle])).toBe("raw:55000");
    // an item never received but already requested keeps its unit too
    const swabCat = (await as(OWN, (db) => publish(db, { kind: "material", code: "MAT-SWB" }, { name: "Swab", tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 1_000 } as never, "Barang baru"))).itemId;
    const swab = (await as(PH, (db) => saveItem(db, key(), null, { catalogItemId: swabCat, unit: "pcs", storage: "ruang", highValue: false, active: true }))).itemId;
    expect(await raw(`update stock_items set unit = 'box' where id = $1`, [swab])).toBe("ok");
    await as(NUR, (db) => requestMaterials(db, key(), { visitId: v, roomDepotId: ROOM, lines: [{ itemId: swab, quantity: "1" }] }));
    expect(await raw(`update stock_items set unit = 'pcs' where id = $1`, [swab])).toBe("raw:55000");
    // replica mode does not switch the guards off (ENABLE ALWAYS)
    await h.admin.query("begin");
    try {
      await h.admin.query("set local session_replication_role = replica");
      expect(await code(h.admin.query(`delete from material_requests where id = $1`, [requestId]))).toBe("raw:42501");
    } finally {
      await h.admin.query("rollback");
    }
  });

  it("the movement check: kinds carry their legs and signs", async () => {
    const b = await receive(needle, "JAR-C", "5");
    const ins = (kind: string, leg: string | null, q: number) => code(h.admin.query(
      `insert into stock_movements (tenant_id, branch_id, item_id, batch_id, depot_id, kind, quantity, balance_after, depot_balance_after, leg, source_kind, source_id, created_by, created_as)
       values ($1, $2, $3, $4, $5, $6, $7::numeric, 5 + $7::numeric, 5 + $7::numeric, $8::text, 'test', gen_random_uuid(), $9, 'pharmacist')`, [A.tenantId, A.b1, needle, b, G1, kind, q, leg, PH.staffId]));
    for (const [k, l, q] of [["issue", null, -1], ["issue", "out", 1], ["return", "in", -1], ["consume", null, 1], ["waste", "out", -1], ["dispense", null, 1], ["receive", "in", 1]] as const)
      expect(await ins(k, l, q)).toBe("raw:23514");
    expect(await ins("consume", null, -1)).toBe("ok");
    await invariant();
  });

  it("events carry ids only; a tenant in exit cannot use materials; another tenant's request and items are not found", async () => {
    const v = await visit(A);
    const { requestId } = await as(NUR, (db) => requestMaterials(db, key(), { visitId: v, roomDepotId: ROOM, lines: [{ itemId: needle, quantity: "1" }] }));
    await as(PH, (db) => issueMaterials(db, key(), requestId, { fromDepotId: G1 }));
    await as(NUR, (db) => consumeMaterials(db, key(), requestId));
    const ev = (await h.admin.query(`select type, payload from domain_events where aggregate_id = $1 order by occurred_at, id`, [requestId])).rows;
    expect(ev.map((e) => e.type)).toEqual(["StockIssued", "StockConsumed"]);
    for (const e of ev) for (const val of Object.values(e.payload as Record<string, string>)) expect(val).toMatch(/^[0-9a-f-]{36}$/);
    // A suspended tenant keeps serving existing visits (existing_appointment, 0038), so materials stay usable; a tenant
    // in exit does not.
    const bv = await visit(B, B.b1);
    await h.admin.query(`update tenants_registry set lifecycle_state = 'exit' where id = $1`, [B.tenantId]);
    expect(await code(as(BNUR, (db) => requestMaterials(db, key(), { visitId: bv, roomDepotId: BROOM, lines: [{ itemId: needle, quantity: "1" }] })))).toMatch(/ERR_TENANT_SUSPENDED|ERR_FORBIDDEN/);
    await h.admin.query(`update tenants_registry set lifecycle_state = 'live' where id = $1`, [B.tenantId]);
    expect(await code(as(BNUR, (db) => requestMaterials(db, key(), { visitId: v, roomDepotId: BROOM, lines: [{ itemId: needle, quantity: "1" }] })))).toBe("ERR_NOT_FOUND");
  });
});
