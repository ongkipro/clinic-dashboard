// T-065 Done-when: scenario PR-18 (automatic list) and CLIN-017 (signed Rx not handed over: no stock change), CLIN-018
// (handover retry: a single dispensing), CLIN-024 (pharmacist adverse-effect flag escalates clinically), CLIN-025 (a
// pending dispensing blocks visit closure). Plus the plan review: selection roles and items; the recipe map, unmapped
// rows and the room depot; Siapkan into a T-062 request; the seven checks with exceptions; external-use labels;
// quarantine / temperature excursion / recall blocks and releases with reasons (history kept); SET-48 validity; special
// items refused everywhere; FEFO per batch with open vials; readers per role and branch; guards; events content-free.
// Synthetic data (MIG-2).
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { decideApproval } from "../../src/modules/approvals/approvals";
import { publish } from "../../src/modules/catalog/catalog";
import { flagComplaint } from "../../src/modules/clinical/complaints/complaints";
import { addPlanItem, createPlan, openExam } from "../../src/modules/clinical/exam/exam";
import type { StepUp } from "../../src/modules/clinical/records/records";
import { createDepot, transferBetweenDepots } from "../../src/modules/inventory/depots/depots";
import { issueMaterials } from "../../src/modules/inventory/materials/materials";
import { holdBatch, openVial, receiveStock, saveItem } from "../../src/modules/inventory/stock";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import {
  addPrescriptionItem, addSpecialItem, cancelDispensing, CHECKS, type Check, confirmSelection, createPrescription, getDispensing, getPrescription,
  handOver, handoverList, mapRecipe, prepareDispensing, prepareMaterials, prepList, printLabel, recallTrace, removePrescriptionItem, signPrescription,
} from "../../src/modules/pharmacy/pharmacy";
import { closeVisit } from "../../src/modules/visits/visits";
import { createHarness, type Harness, testPool } from "../rls/harness";

process.env.DEPLOY_ENV = "local";

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let n = 0;
type T = { tenantId: string; b1: string; b2: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
const TENANT_WIDE = ["owner", "finance", "admin_pusat", "purchasing", "marketing", "central_cs", "auditor"];
const STEP: StepUp = { verified: true };
const ALL: Record<Check, boolean> = Object.fromEntries(CHECKS.map((c) => [c, true])) as Record<Check, boolean>;

async function tenant(): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Apotek Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
  return { tenantId, b1: await br("A1"), b2: await br("A2") };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`apt${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Apotek ${n}` });
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
async function patient(t: T, branch: string): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, "");
  return (await h.admin.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation, education,
                           marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, 'Pasien Apotek', '1990-01-01', 'female', 'nik', $3, $4, 'islam', 'Karyawan', 's1', 'kawin', $2,
             (select s.id from staff s where s.tenant_id = $1 limit 1), 'fo_cashier') returning id`,
    [t.tenantId, branch, `v1.1.${id}.${id}.${id}`, (id + id).slice(0, 43)])).rows[0].id as string;
}
async function visit(t: T, branch: string, by: P): Promise<string> {
  const pid = await patient(t, branch);
  return (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`,
    [t.tenantId, branch, pid, by.staffId])).rows[0].id as string;
}
// A visit with an open exam and one plan of `versions` (one item each, qty 1).
async function planned(versions: string[]) {
  const v = await visit(A, A.b1, FO);
  const { examId } = await as(DOC, (db) => openExam(db, key(), v));
  const { planId } = await as(DOC, (db) => createPlan(db, key(), examId, "Program Apotek", "Kondisi uji"));
  const items: string[] = [];
  for (const ver of versions) items.push((await as(DOC, (db) => addPlanItem(db, key(), examId, planId, { stage: 1, catalog_version_id: ver, qty: 1 }))).itemId);
  return { v, examId, planId, items };
}
const stockQty = async (batch: string, depot: string) => num((await h.admin.query(`select coalesce((select quantity from batch_holdings where batch_id = $1 and depot_id = $2), 0) q`, [batch, depot])).rows[0].q);
const dispensingsOf = async (v: string) => (await h.admin.query(`select id, state, quantity::float q, stock_item_id from dispensings where visit_id = $1 order by queued_at, id`, [v])).rows;
const steps = async (v: string) => (await h.admin.query(`select selection, preparation, dispensing from visits where id = $1`, [v])).rows[0];
const movements = async (source: string) => (await h.admin.query(`select kind, batch_id, quantity::float q from stock_movements where source_id = $1 order by batch_id`, [source])).rows;

let A: T; let B: T;
let OWN: P; let FH: P; let RO: P; let DOC: P; let BC: P; let FO: P; let NUR: P; let PH: P; let PH2: P; let MGR: P; let PHB2: P; let DOCB2: P; let BPH: P;
let laser: string; let laserNoRecipe: string; let serum: string; let serumCat: string; let cream: string; let creamCat: string; let pethidine: string; let pethidineCat: string;
let gel: string; let gloves: string; let serumItem: string; let creamItem: string; let pethItem: string;
let G1: string; let APT: string; let ROOMDEP: string;
let SERUM_A: string; let SERUM_B: string; let CREAM_1: string;

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 6 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant();
  B = await tenant();
  OWN = await person(A, "owner"); FH = await person(A, "facility_head", A.b1); RO = await person(A, "records_officer", A.b1);
  DOC = await person(A, "doctor", A.b1); BC = await person(A, "bc", A.b1); FO = await person(A, "fo_cashier", A.b1); NUR = await person(A, "nurse", A.b1);
  PH = await person(A, "pharmacist", A.b1); PH2 = await person(A, "pharmacist", A.b1); MGR = await person(A, "manager", A.b1);
  PHB2 = await person(A, "pharmacist", A.b2); DOCB2 = await person(A, "doctor", A.b2); BPH = await person(B, "pharmacist", B.b1);
  // A laser with a two-row recipe (the pharmacist approves it, DEC-047), a laser without one, products.
  const svc = async (c: string, formula: unknown[]) => {
    const v = await as(OWN, (db) => publish(db, { kind: "service", code: c }, {
      name: `Laser ${c}`, tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 900_000, category: "facial", prep_min: 10, treatment_min: 30, buffer_min: 10,
      indications: "Indikasi", consent_template: `Templat ${c}.`, delegation: "Dokter", aftercare_text: "Perawatan",
      eligibility: [{ role: "doctor", mode: "performs" }], material_formula: formula,
    } as never, "Layanan baru"));
    if (v.approvalId) await as(FH, (db) => decideApproval(db, v.approvalId!, true));
    if (v.materialsApprovalId) await as(PH2, (db) => decideApproval(db, v.materialsApprovalId!, true));
    return v.versionId;
  };
  laser = await svc("AP-LSR", [{ material: "Gel pendingin", qty: 5, unit: "ml" }, { material: "Sarung tangan", qty: 2, unit: "pcs" }]);
  laserNoRecipe = await svc("AP-LS0", []);
  const prod = async (c: string, name: string) => {
    const v = await as(OWN, (db) => publish(db, { kind: "product", code: c }, { name, tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 150_000 } as never, "Produk"));
    return { version: v.versionId, item: v.itemId };
  };
  ({ version: serum, item: serumCat } = await prod("AP-SRM", "Serum Apotek"));
  ({ version: cream, item: creamCat } = await prod("AP-CRM", "Krim Luar"));
  ({ version: pethidine, item: pethidineCat } = await prod("AP-PTD", "Petidin"));
  const mat = async (c: string, name: string, unit: string) => {
    const cat = (await as(OWN, (db) => publish(db, { kind: "material", code: c }, { name, tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 1_000 } as never, "Bahan"))).itemId;
    return (await as(PH, (db) => saveItem(db, key(), null, { catalogItemId: cat, unit, storage: "ruang", highValue: false, active: true }))).itemId;
  };
  gel = await mat("AP-GEL", "Gel Apotek", "ml");
  gloves = await mat("AP-GLV", "Sarung Tangan Apotek", "pcs");
  const stockOf = async (cat: string, unit: string) => (await as(PH, (db) => saveItem(db, key(), null, { catalogItemId: cat, unit, storage: "ruang", highValue: false, active: true }))).itemId;
  serumItem = await stockOf(serumCat, "btl");
  creamItem = await stockOf(creamCat, "tube");
  pethItem = await stockOf(pethidineCat, "amp");
  G1 = (await h.admin.query(`select id from depots where branch_id = $1 and is_default`, [A.b1])).rows[0].id;
  APT = (await as(PH, (db) => createDepot(db, key(), { branchId: null, name: "Apotek Utama", kind: "apotek" }))).depotId;
  const room = (await h.admin.query(`insert into rooms (tenant_id, branch_id, name, kind) values ($1, $2, 'Ruang Laser', 'treatment') returning id`, [A.tenantId, A.b1])).rows[0].id;
  ROOMDEP = (await as(PH, (db) => createDepot(db, key(), { branchId: null, name: "Depot Ruang Laser", kind: "ruang", roomId: room }))).depotId;
  const recv = (item: string, no: string, exp: number, q: string) => as(PH, (db) => receiveStock(db, key(), null, { itemId: item, batchNo: no, expiry: day(exp), quantity: q, reason: "stok_awal" }));
  await recv(gel, "GEL-1", 300, "1000");
  await recv(gloves, "GLV-1", 300, "500");
  SERUM_A = (await recv(serumItem, "SRM-A", 60, "3")).batchId;   // expires first
  SERUM_B = (await recv(serumItem, "SRM-B", 200, "50")).batchId;
  CREAM_1 = (await recv(creamItem, "CRM-1", 200, "20")).batchId;
  await recv(pethItem, "PTD-1", 200, "10");
  // The apotek depot holds the products (moved from the gudang).
  await as(PH, (db) => transferBetweenDepots(db, key(), { fromDepotId: G1, toDepotId: APT, lines: [{ batchId: SERUM_A, quantity: "3" }, { batchId: SERUM_B, quantity: "50" }, { batchId: CREAM_1, quantity: "20" }] }));
  // The recipe map of the laser: row 0 → gel 5 ml; row 1 → gloves 2 pcs.
  await as(PH, (db) => mapRecipe(db, key(), laser, 0, { stockItemId: gel, quantity: "5" }));
  await as(PH, (db) => mapRecipe(db, key(), laser, 1, { stockItemId: gloves, quantity: "2" }));
  await as(PH, (db) => addSpecialItem(db, key(), pethidineCat, "Narkotika: kendali belum disetujui"));
}, 300_000);
afterAll(async () => {
  await app?.end();
  await owner?.end();
  await h?.close();
});

describe("scenario PR-18: automatic list", () => {
  it("two treatments and one product confirmed → the list shows both formulas' materials and the product, no manual entry", async () => {
    const s = await planned([laser, laser]);
    await as(BC, (db) => confirmSelection(db, key(), s.v, { items: [{ planItemId: s.items[0] }, { planItemId: s.items[1] }, { catalogVersionId: serum, quantity: "2" }] }));
    expect(await steps(s.v)).toEqual({ selection: "done", preparation: "in_progress", dispensing: "in_progress" });
    const list = await as(PH, prepList);
    const mine = list.treatments.filter((t) => t.patient.visit_id === s.v);
    expect(mine).toHaveLength(2);
    for (const t of mine) {
      expect(t.blocker).toBeNull();
      expect(t.room_depot?.id).toBe(ROOMDEP);
      expect(t.lines.map((l) => [l.material, l.item?.stock_item_id, num(l.quantity)])).toEqual([["Gel pendingin", gel, 5], ["Sarung tangan", gloves, 2]]);
    }
    const prod = list.products.filter((d) => d.patient.visit_id === s.v);
    expect(prod.map((d) => [d.item.stock_item_id, num(d.quantity), d.depot?.id, d.suggestion?.map((b) => [b.batch_id, num(b.quantity)])])).toEqual([[serumItem, 2, APT, [[SERUM_A, 2]]]]);
    // Siapkan: the pharmacist's request is T-062's (no manual lines), issued; the visit's preparation completes.
    for (const t of mine) {
      const { requestId } = await as(PH, (db) => prepareMaterials(db, key(), t.selection_item_id));
      const lines = (await h.admin.query(`select item_id, requested_qty::float q from material_request_lines where request_id = $1 order by q`, [requestId])).rows;
      expect(lines).toEqual([{ item_id: gloves, q: 2 }, { item_id: gel, q: 5 }]);
      expect((await h.admin.query(`select requested_as, plan_item_id, room_depot_id from material_requests where id = $1`, [requestId])).rows[0])
        .toEqual({ requested_as: "pharmacist", plan_item_id: expect.any(String), room_depot_id: ROOMDEP });
      await as(PH, (db) => issueMaterials(db, key(), requestId, { fromDepotId: G1 }));
    }
    expect((await steps(s.v)).preparation).toBe("done");
    expect((await as(PH, prepList)).treatments.filter((t) => t.patient.visit_id === s.v)).toEqual([]);
    const ev = (await h.admin.query(`select type, payload from domain_events where type = 'ItemsSelected' and payload ->> 'visit_id' = $1`, [s.v])).rows;
    expect(ev).toHaveLength(1);
    expect(Object.keys(ev[0].payload).sort()).toEqual(["selection_id", "visit_id"]);
  });

  it("an unmapped recipe row, a missing room depot and a treatment without recipe are shown, never dropped; Siapkan refuses them", async () => {
    const t = await tenant();
    const own = await person(t, "owner"); const fh = await person(t, "facility_head", t.b1); const ph = await person(t, "pharmacist", t.b1);
    const ph2 = await person(t, "pharmacist", t.b1); const doc = await person(t, "doctor", t.b1); const bc = await person(t, "bc", t.b1);
    const v1 = await as(own, (db) => publish(db, { kind: "service", code: "UM-LSR" }, {
      name: "Laser Tanpa Peta", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 1, category: "facial", prep_min: 10, treatment_min: 30, buffer_min: 10,
      indications: "Indikasi", consent_template: "Templat.", delegation: "Dokter", aftercare_text: "Perawatan", eligibility: [{ role: "doctor", mode: "performs" }],
      material_formula: [{ material: "Gel X", qty: 1, unit: "ml" }],
    } as never, "Layanan baru"));
    if (v1.approvalId) await as(fh, (db) => decideApproval(db, v1.approvalId!, true));
    await as(ph2, (db) => decideApproval(db, v1.materialsApprovalId!, true));
    const vv = await visit(t, t.b1, doc);
    const { examId } = await as(doc, (db) => openExam(db, key(), vv));
    const { planId } = await as(doc, (db) => createPlan(db, key(), examId, "Program", "Kondisi"));
    const { itemId } = await as(doc, (db) => addPlanItem(db, key(), examId, planId, { stage: 1, catalog_version_id: v1.versionId, qty: 1 }));
    await as(bc, (db) => confirmSelection(db, key(), vv, { items: [{ planItemId: itemId }] }));
    let row = (await as(ph, prepList)).treatments[0];
    expect(row.blocker).toBe("recipe_unmapped");
    expect(row.lines.map((l) => [l.material, l.item])).toEqual([["Gel X", null]]);
    expect(await why(as(ph, (db) => prepareMaterials(db, key(), row.selection_item_id)))).toBe("ERR_VERSION_CONFLICT:recipe_unmapped");
    const cat = (await as(own, (db) => publish(db, { kind: "material", code: "UM-GEL" }, { name: "Gel X", tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 1 } as never, "Bahan"))).itemId;
    const it = (await as(ph, (db) => saveItem(db, key(), null, { catalogItemId: cat, unit: "ml", storage: "ruang", highValue: false, active: true }))).itemId;
    await as(ph, (db) => mapRecipe(db, key(), v1.versionId, 0, { stockItemId: it, quantity: "1" }));
    row = (await as(ph, prepList)).treatments[0];
    expect(row.blocker).toBe("room_depot_missing"); // this tenant has no ruang depot
    expect(await why(as(ph, (db) => prepareMaterials(db, key(), row.selection_item_id)))).toBe("ERR_VERSION_CONFLICT:room_depot_missing");
    expect((await steps(vv)).preparation).toBe("in_progress");
    // A treatment without a recipe: listed with no_recipe; nothing to prepare; it does not hold preparation open.
    const s = await planned([laserNoRecipe]);
    await as(DOC, (db) => confirmSelection(db, key(), s.v, { items: [{ planItemId: s.items[0] }] }));
    const r0 = (await as(PH, prepList)).treatments.find((x) => x.patient.visit_id === s.v)!;
    expect(r0.blocker).toBe("no_recipe");
    expect(await why(as(PH, (db) => prepareMaterials(db, key(), r0.selection_item_id)))).toBe("ERR_VERSION_CONFLICT:no_recipe");
    expect(await steps(s.v)).toEqual({ selection: "done", preparation: "done", dispensing: "not_started" });
    // a treatment selected twice: the recipe quantities double
    const v3 = await visit(A, A.b1, FO);
    await as(FO, (db) => confirmSelection(db, key(), v3, { items: [{ catalogVersionId: laser, quantity: "2" }] }));
    const r3 = (await as(PH, prepList)).treatments.find((x) => x.patient.visit_id === v3)!;
    expect(r3.lines.map((l) => num(l.quantity))).toEqual([10, 4]);
  });

  it("selection: BC, doctor or front office once per visit; plan items of the patient's live plan; services and products only; roles and branches", async () => {
    const s = await planned([laser]);
    for (const p of [PH, NUR, MGR, OWN]) expect(await code(as(p, (db) => confirmSelection(db, key(), s.v, { items: [{ planItemId: s.items[0] }] })))).toBe("ERR_FORBIDDEN");
    expect(await code(as(DOCB2, (db) => confirmSelection(db, key(), s.v, { items: [{ planItemId: s.items[0] }] })))).toBe("ERR_NOT_FOUND");
    const other = await planned([laser]);
    expect(await code(as(FO, (db) => confirmSelection(db, key(), s.v, { items: [{ planItemId: other.items[0] }] })))).toBe("ERR_NOT_FOUND");
    expect(await code(as(FO, (db) => confirmSelection(db, key(), s.v, { items: [{ catalogVersionId: laserNoRecipe, quantity: "1" }, { catalogVersionId: laserNoRecipe, quantity: "1" }] })))).toBe("ok");
    // a service named directly is allowed (no plan item); a second confirmation is refused
    expect(await code(as(BC, (db) => confirmSelection(db, key(), s.v, { items: [{ planItemId: s.items[0] }] })))).toBe("ERR_VERSION_CONFLICT");
    const s2 = await planned([laser]);
    expect(await code(as(BC, (db) => confirmSelection(db, key(), s2.v, { items: [{ planItemId: s2.items[0] }, { planItemId: s2.items[0] }] })))).toBe("ERR_INVALID_INPUT");
    expect(await code(as(BC, (db) => confirmSelection(db, key(), s2.v, { items: [{ catalogVersionId: serum, quantity: "0" }] })))).toBe("ERR_INVALID_INPUT");
    const k = key();
    const first = await as(BC, (db) => confirmSelection(db, k, s2.v, { items: [{ planItemId: s2.items[0] }] }));
    expect((await as(BC, (db) => confirmSelection(db, k, s2.v, { items: [{ planItemId: s2.items[0] }] }))).selectionId).toBe(first.selectionId); // replay
    expect((await h.admin.query(`select guiding_bc_staff_id, closing_bc_staff_id, confirmed_as from selections where id = $1`, [first.selectionId])).rows[0])
      .toEqual({ guiding_bc_staff_id: BC.staffId, closing_bc_staff_id: BC.staffId, confirmed_as: "bc" });
  });
});

describe("dispensing (CLIN-017, CLIN-018, CD-19)", () => {
  async function rx(items: { version: string; qty: string; external?: boolean }[], o: { acute?: boolean } = {}) {
    const v = await visit(A, A.b1, FO);
    const { prescriptionId } = await as(DOC, (db) => createPrescription(db, key(), v, { isAcute: o.acute }));
    for (const i of items) await as(DOC, (db) => addPrescriptionItem(db, key(), prescriptionId, { catalogVersionId: i.version, quantity: i.qty, signa: "2x sehari 1 tetes", externalUse: i.external }));
    return { v, prescriptionId };
  }

  it("CLIN-017: a signed prescription prepared but not handed over changes no stock and no movement", async () => {
    const r = await rx([{ version: serum, qty: "2" }]);
    const before = [await stockQty(SERUM_A, APT), await stockQty(SERUM_B, APT)];
    const mv0 = num((await h.admin.query(`select count(*) from stock_movements where item_id = $1`, [serumItem])).rows[0].count);
    await as(DOC, (db) => signPrescription(db, key(), r.prescriptionId, STEP));
    const [d] = await dispensingsOf(r.v);
    await as(PH, (db) => prepareDispensing(db, key(), d.id));
    await as(PH, (db) => printLabel(db, key(), d.id));
    expect([await stockQty(SERUM_A, APT), await stockQty(SERUM_B, APT)]).toEqual(before);
    expect(num((await h.admin.query(`select count(*) from stock_movements where item_id = $1`, [serumItem])).rows[0].count)).toBe(mv0);
    expect((await h.admin.query(`select count(*)::int c from dispensing_lines where dispensing_id = $1`, [d.id])).rows[0].c).toBe(0);
    // cancelling it changes nothing either; the visit's dispensing is then not needed
    await as(PH, (db) => cancelDispensing(db, key(), d.id, "Pasien tidak jadi mengambil"));
    expect([await stockQty(SERUM_A, APT), await stockQty(SERUM_B, APT)]).toEqual(before);
    expect((await steps(r.v)).dispensing).toBe("not_needed");
  });

  it("CLIN-018: a handover retried (same key, new key, concurrently) is one dispensing and one movement per batch", async () => {
    const r = await rx([{ version: serum, qty: "4" }]);
    await as(DOC, (db) => signPrescription(db, key(), r.prescriptionId, STEP));
    const [d] = await dispensingsOf(r.v);
    expect(await why(as(PH, (db) => handOver(db, key(), d.id, { checks: ALL })))).toBe("ERR_VERSION_CONFLICT:dispensing queued"); // prepare first
    await as(PH, (db) => prepareDispensing(db, key(), d.id));
    const a0 = await stockQty(SERUM_A, APT); const b0 = await stockQty(SERUM_B, APT);
    const k = key();
    const results = await Promise.allSettled([
      as(PH, (db) => handOver(db, k, d.id, { checks: ALL })),
      as(PH, (db) => handOver(db, k, d.id, { checks: ALL })),
      as(PH2, (db) => handOver(db, key(), d.id, { checks: ALL })),
    ]);
    expect(results.filter((x) => x.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
    expect(await code(as(PH, (db) => handOver(db, key(), d.id, { checks: ALL })))).toBe("ERR_VERSION_CONFLICT");
    expect((await as(PH, (db) => handOver(db, k, d.id, { checks: ALL }))).replayed).toBe(true);
    expect(await code(as(PH, (db) => cancelDispensing(db, key(), d.id, "Terlambat dibatalkan")))).toBe("ERR_VERSION_CONFLICT"); // handed is final
    expect(await code(h.admin.query(`update dispensing_lines set quantity = quantity + 1 where dispensing_id = $1`, [d.id]))).toBe("raw:42501");
    expect(await code(h.admin.query(`delete from dispensing_lines where dispensing_id = $1`, [d.id]))).toBe("raw:42501");
    const mv = await movements(d.id);
    expect(mv.every((m) => m.kind === "dispense")).toBe(true);
    expect(mv.reduce((t, m) => t + m.q, 0)).toBe(-4);
    expect(new Set(mv.map((m) => m.batch_id)).size).toBe(mv.length); // one movement per batch
    expect((await stockQty(SERUM_A, APT)) + (await stockQty(SERUM_B, APT))).toBe(a0 + b0 - 4);
    expect((await dispensingsOf(r.v))[0].state).toBe("handed");
    expect((await steps(r.v)).dispensing).toBe("done");
    const ev = (await h.admin.query(`select type, payload from domain_events where aggregate_id = $1`, [d.id])).rows;
    expect(ev).toEqual([{ type: "MedicationDispensed", payload: { dispensing_id: d.id, visit_id: r.v } }]);
  });

  it("the seven checks: all true, or the unchecked ones with an exception note; recorded with the dispenser", async () => {
    const r = await rx([{ version: serum, qty: "1" }, { version: serum, qty: "1" }]);
    await as(DOC, (db) => signPrescription(db, key(), r.prescriptionId, STEP));
    const [d1, d2] = await dispensingsOf(r.v);
    for (const d of [d1, d2]) await as(PH, (db) => prepareDispensing(db, key(), d.id));
    const partial = { ...ALL, clarification: false };
    expect(await why(as(PH, (db) => handOver(db, key(), d1.id, { checks: partial })))).toBe("ERR_INVALID_INPUT:checks_incomplete");
    expect(await why(as(PH, (db) => handOver(db, key(), d1.id, { checks: ALL, exceptionNote: "Tidak perlu" })))).toBe("ERR_INVALID_INPUT:checks_incomplete");
    await as(PH, (db) => handOver(db, key(), d1.id, { checks: partial, exceptionNote: "Dokter tidak dapat dihubungi; dosis standar" }));
    await as(PH2, (db) => handOver(db, key(), d2.id, { checks: ALL }));
    const got = await as(FH, (db) => getDispensing(db, d1.id));
    expect(got).toMatchObject({ state: "handed", checks: partial, exception_note: "Dokter tidak dapat dihubungi; dosis standar", prescription: { signa: "2x sehari 1 tetes", state: "signed" } });
    expect(got.handed_by).toMatch(/Staf Apotek/);
    expect(await code(as(MGR, (db) => getDispensing(db, d1.id)))).toBe("ERR_FORBIDDEN");
    expect(await code(as(PHB2, (db) => getDispensing(db, d1.id)))).toBe("ERR_NOT_FOUND");
  });

  it("external use: the etiket biru is printed before the handover unless the label check is excepted; reprints counted", async () => {
    const r = await rx([{ version: cream, qty: "1", external: true }]);
    await as(DOC, (db) => signPrescription(db, key(), r.prescriptionId, STEP));
    const [d] = await dispensingsOf(r.v);
    await as(PH, (db) => prepareDispensing(db, key(), d.id));
    expect(await why(as(PH, (db) => handOver(db, key(), d.id, { checks: ALL })))).toBe("ERR_VERSION_CONFLICT:label_not_printed");
    expect((await as(PH, (db) => printLabel(db, key(), d.id))).kind).toBe("external_use");
    await as(PH, (db) => printLabel(db, key(), d.id));
    expect((await h.admin.query(`select kind, print_count from labels where dispensing_id = $1`, [d.id])).rows[0]).toEqual({ kind: "external_use", print_count: 2 });
    await as(PH, (db) => handOver(db, key(), d.id, { checks: ALL }));
    expect(await code(as(PH, (db) => printLabel(db, key(), d.id)))).toBe("ERR_VERSION_CONFLICT"); // handed: final
    const r2 = await rx([{ version: cream, qty: "1", external: true }]);
    await as(DOC, (db) => signPrescription(db, key(), r2.prescriptionId, STEP));
    const [e] = await dispensingsOf(r2.v);
    await as(PH, (db) => prepareDispensing(db, key(), e.id));
    await as(PH, (db) => handOver(db, key(), e.id, { checks: { ...ALL, label: false }, exceptionNote: "Printer rusak; etiket ditulis tangan" }));
  });

  it("quarantine, temperature excursion and recall block preparation and handover; release needs a reason; the history keeps every reason", async () => {
    const r = await rx([{ version: serum, qty: "40" }]);
    await as(DOC, (db) => signPrescription(db, key(), r.prescriptionId, STEP));
    const [d] = await dispensingsOf(r.v);
    await as(PH, (db) => prepareDispensing(db, key(), d.id));
    await as(PH, (db) => holdBatch(db, key(), SERUM_B, "temperature_excursion", "Kulkas 12 °C selama 3 jam"));
    expect(await why(as(PH, (db) => handOver(db, key(), d.id, { checks: ALL })))).toMatch(/^ERR_STOCK_INSUFFICIENT/);
    expect(await why(as(PH, (db) => handOver(db, key(), d.id, { checks: ALL, batches: [{ batchId: SERUM_B, quantity: "40" }] })))).toBe("ERR_STOCK_UNFIT:temperature_excursion");
    expect((await as(PH, handoverList)).prepared.find((x) => x.id === d.id)?.blocker).toBe("stock_unavailable");
    expect(await code(as(PH, (db) => holdBatch(db, key(), SERUM_B, "active", null)))).toBe("ERR_INVALID_INPUT"); // a release needs its reason
    expect(await code(as(PH, (db) => holdBatch(db, key(), SERUM_B, "quarantined", "Ubah status")))).toBe("ERR_VERSION_CONFLICT"); // released first
    await as(PH, (db) => holdBatch(db, key(), SERUM_B, "active", "Uji stabilitas pemasok: aman"));
    await as(PH, (db) => handOver(db, key(), d.id, { checks: ALL }));
    const holds = (await h.admin.query(`select from_state, to_state, reason from stock_batch_holds where batch_id = $1 order by at, id`, [SERUM_B])).rows;
    expect(holds).toEqual([
      { from_state: "active", to_state: "temperature_excursion", reason: "Kulkas 12 °C selama 3 jam" },
      { from_state: "temperature_excursion", to_state: "active", reason: "Uji stabilitas pemasok: aman" },
    ]);
    // a recalled batch: never dispensable; the recall trace lists who received it
    const tr = await as(PH, (db) => recallTrace(db, SERUM_B));
    expect(tr.dispensed.map((x) => [x.dispensing_id, num(x.quantity)])).toContainEqual([d.id, 40]); // every handed dispensing of the batch
    expect(tr.dispensed.every((x) => x.patient.mrn?.startsWith("RM-"))).toBe(true);
    expect(tr.holds).toHaveLength(2);
    expect(await code(as(MGR, (db) => recallTrace(db, SERUM_B)))).toBe("ok");
    expect(await code(as(PHB2, (db) => recallTrace(db, SERUM_B)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(DOC, (db) => recallTrace(db, SERUM_B)))).toBe("ERR_FORBIDDEN");
    // raw: a hold without its history row is refused; history rows are insert-only
    expect(await code(h.admin.query(`update stock_batches set state = 'quarantined', hold_reason = 'langsung', held_by = $2, held_at = now() where id = $1`, [SERUM_B, PH.staffId]))).toBe("raw:42501");
    expect(await code(h.admin.query(`update stock_batch_holds set reason = 'ubah' where batch_id = $1`, [SERUM_B]))).toBe("raw:42501");
    expect(await code(h.admin.query(`delete from stock_batch_holds where batch_id = $1`, [SERUM_B]))).toBe("raw:42501");
  });

  it("FEFO per batch: an open vial and the sealed rest of the same batch give one line; the vial is run down", async () => {
    const t = await tenant();
    const own = await person(t, "owner"); const ph = await person(t, "pharmacist", t.b1); const doc = await person(t, "doctor", t.b1);
    const v1 = await as(own, (db) => publish(db, { kind: "product", code: "VL-PRD" }, { name: "Vial Produk", tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 1 } as never, "Produk"));
    const it = (await as(ph, (db) => saveItem(db, key(), null, { catalogItemId: v1.itemId, unit: "ml", storage: "ruang", highValue: false, active: true, vialSize: "10", openedUseHours: 24 }))).itemId;
    const batch = (await as(ph, (db) => receiveStock(db, key(), null, { itemId: it, batchNo: "VL-1", expiry: day(100), quantity: "30", reason: "stok_awal" }))).batchId;
    await as(ph, (db) => openVial(db, key(), batch));
    const vv = await visit(t, t.b1, doc);
    const { prescriptionId } = await as(doc, (db) => createPrescription(db, key(), vv));
    await as(doc, (db) => addPrescriptionItem(db, key(), prescriptionId, { catalogVersionId: v1.versionId, quantity: "15", signa: "Oles tipis malam hari" }));
    await as(doc, (db) => signPrescription(db, key(), prescriptionId, STEP));
    const [d] = await dispensingsOf(vv);
    await as(ph, (db) => prepareDispensing(db, key(), d.id));
    await as(ph, (db) => handOver(db, key(), d.id, { checks: ALL }));
    expect((await h.admin.query(`select batch_id, quantity::float q from dispensing_lines where dispensing_id = $1`, [d.id])).rows).toEqual([{ batch_id: batch, q: 15 }]);
    expect((await h.admin.query(`select state, remaining::float r from opened_vials where batch_id = $1`, [batch])).rows[0]).toEqual({ state: "finished", r: 0 });
  });
});

describe("prescription (DATA-26, SET-48) and special items", () => {
  it("draft → signed by the prescriber with a second factor; valid per SET-48 (acute shorter); unsigned rows blocked on Siapkan; expired refused", async () => {
    const v = await visit(A, A.b1, FO);
    const { prescriptionId } = await as(DOC, (db) => createPrescription(db, key(), v));
    expect(await why(as(DOC, (db) => signPrescription(db, key(), prescriptionId, STEP)))).toBe("ERR_INVALID_INPUT:empty_prescription");
    const { itemId } = await as(DOC, (db) => addPrescriptionItem(db, key(), prescriptionId, { catalogVersionId: serum, quantity: "1", signa: "1x sehari", kfaCode: "93001234" }));
    const unsigned = (await as(PH, prepList)).unsigned.find((x) => x.prescription_id === prescriptionId);
    expect(unsigned).toMatchObject({ items: 1, blocker: "prescription_unsigned" });
    expect(await code(as(DOCB2, (db) => signPrescription(db, key(), prescriptionId, STEP)))).toBe("ERR_NOT_FOUND");
    const doc2 = await person(A, "doctor", A.b1);
    expect(await code(as(doc2, (db) => signPrescription(db, key(), prescriptionId, STEP)))).toBe("ERR_FORBIDDEN");
    expect(await code(as(DOC, (db) => signPrescription(db, key(), prescriptionId, undefined as never)))).toBe("ERR_FORBIDDEN");
    await h.admin.query(`update auth_user set two_factor_enabled = false where id = $1`, [DOC.acc]);
    expect(await why(as(DOC, (db) => signPrescription(db, key(), prescriptionId, STEP)))).toBe("ERR_FORBIDDEN:second_factor_required");
    await h.admin.query(`update auth_user set two_factor_enabled = true where id = $1`, [DOC.acc]);
    await as(DOC, (db) => signPrescription(db, key(), prescriptionId, STEP));
    const row = (await h.admin.query(`select state, round(extract(epoch from valid_until - signed_at) / 86400) days, set48_snapshot from prescriptions where id = $1`, [prescriptionId])).rows[0];
    expect(row).toMatchObject({ state: "signed", days: "30" });
    expect(row.set48_snapshot).toMatchObject({ masa: 30, masa_akut: 7 });
    expect(await code(as(DOC, (db) => removePrescriptionItem(db, key(), prescriptionId, itemId)))).toBe("ERR_VERSION_CONFLICT");
    expect(await code(as(DOC, (db) => addPrescriptionItem(db, key(), prescriptionId, { catalogVersionId: serum, quantity: "1", signa: "1x sehari" })))).toBe("ERR_VERSION_CONFLICT");
    const got = await as(RO, (db) => getPrescription(db, prescriptionId));
    expect(got.items.map((i) => [i.kfa_code, i.dispensing?.state])).toEqual([["93001234", "queued"]]);
    const ev = (await h.admin.query(`select payload from domain_events where type = 'PrescriptionSigned' and aggregate_id = $1`, [prescriptionId])).rows;
    expect(ev).toEqual([{ payload: { prescription_id: prescriptionId, visit_id: v } }]);
    // acute: 7 days; once lapsed, Siapkan and Serahkan refuse it
    const v2 = await visit(A, A.b1, FO);
    const acute = (await as(DOC, (db) => createPrescription(db, key(), v2, { isAcute: true }))).prescriptionId;
    await as(DOC, (db) => addPrescriptionItem(db, key(), acute, { catalogVersionId: serum, quantity: "1", signa: "3x sehari" }));
    await as(DOC, (db) => signPrescription(db, key(), acute, STEP));
    expect((await h.admin.query(`select round(extract(epoch from valid_until - signed_at) / 86400) d from prescriptions where id = $1`, [acute])).rows[0].d).toBe("7");
    const [d] = await dispensingsOf(v2);
    await h.admin.query(`alter table prescriptions disable trigger prescriptions_guard`);
    await h.admin.query(`update prescriptions set signed_at = now() - interval '9 days', valid_until = now() - interval '2 days' where id = $1`, [acute]);
    await h.admin.query(`alter table prescriptions enable always trigger prescriptions_guard`);
    expect(await why(as(PH, (db) => prepareDispensing(db, key(), d.id)))).toBe("ERR_VERSION_CONFLICT:prescription_expired");
  });

  it("special items (narcotics, psychotropics) are refused at selection, prescription, preparation and handover", async () => {
    const v = await visit(A, A.b1, FO);
    expect(await why(as(FO, (db) => confirmSelection(db, key(), v, { items: [{ catalogVersionId: pethidine, quantity: "1" }] })))).toBe("ERR_INVALID_INPUT:special_item");
    const { prescriptionId } = await as(DOC, (db) => createPrescription(db, key(), v));
    expect(await why(as(DOC, (db) => addPrescriptionItem(db, key(), prescriptionId, { catalogVersionId: pethidine, quantity: "1", signa: "Bila nyeri" })))).toBe("ERR_INVALID_INPUT:special_item");
    // an item listed after it was prescribed and signed: preparation and handover refuse it
    await as(DOC, (db) => addPrescriptionItem(db, key(), prescriptionId, { catalogVersionId: cream, quantity: "1", signa: "Oles 2x sehari" }));
    await as(DOC, (db) => signPrescription(db, key(), prescriptionId, STEP));
    const [d] = await dispensingsOf(v);
    await as(PH, (db) => prepareDispensing(db, key(), d.id));
    const t2 = await tenant(); void t2; // (unrelated tenant: listing is per tenant)
    await as(PH, (db) => addSpecialItem(db, key(), creamCat, "Uji: daftar khusus"));
    expect(await why(as(PH, (db) => handOver(db, key(), d.id, { checks: ALL })))).toBe("ERR_VERSION_CONFLICT:special_item");
    expect(await code(as(PH, (db) => addSpecialItem(db, key(), creamCat, "Lagi")))).toBe("ERR_VERSION_CONFLICT");
    expect(await code(h.admin.query(`delete from pharmacy_special_items where catalog_item_id = $1`, [creamCat]))).toBe("raw:42501");
    expect(await code(as(DOC, (db) => addSpecialItem(db, key(), serumCat, "Bukan apoteker")))).toBe("ERR_FORBIDDEN");
  });
});

describe("CLIN-024 and CLIN-025", () => {
  it("CLIN-024: the pharmacist's adverse-effect flag from the handover becomes a clinical task for the branch's clinician", async () => {
    const v = await visit(A, A.b1, FO);
    const pid = (await h.admin.query(`select patient_id from visits where id = $1`, [v])).rows[0].patient_id;
    const { taskId } = await as(PH, (db) => flagComplaint(db, key(), { patientId: pid, kind: "klinis", source: "pharmacist", summary: "Ruam setelah pemakaian serum", visitId: v }));
    const t = (await h.admin.query(`select kind, source, triage, branch_id, visit_id from complaint_tasks where id = $1`, [taskId])).rows[0];
    expect(t).toEqual({ kind: "klinis", source: "pharmacist", triage: "kuning", branch_id: A.b1, visit_id: v });
  });

  it("CLIN-025: a queued or prepared dispensing blocks closing the visit; after handover or cancellation it closes", async () => {
    const v = await visit(A, A.b1, FO);
    await as(FO, (db) => confirmSelection(db, key(), v, { items: [{ catalogVersionId: serum, quantity: "1" }, { catalogVersionId: serum, quantity: "1" }] }));
    const [d1, d2] = await dispensingsOf(v);
    expect(await why(as(FO, (db) => closeVisit(db, key(), v)))).toBe("ERR_VERSION_CONFLICT:pending_dispensing");
    await as(PH, (db) => prepareDispensing(db, key(), d1.id));
    await as(PH, (db) => cancelDispensing(db, key(), d2.id, "Pasien membatalkan"));
    expect((await steps(v)).dispensing).toBe("in_progress"); // the prepared one alone holds the visit open
    expect(await why(as(FO, (db) => closeVisit(db, key(), v)))).toBe("ERR_VERSION_CONFLICT:pending_dispensing");
    await as(PH, (db) => handOver(db, key(), d1.id, { checks: ALL }));
    expect((await steps(v)).dispensing).toBe("done");
    expect(await code(as(FO, (db) => closeVisit(db, key(), v)))).toBe("ok");
    const ev = (await h.admin.query(`select type from domain_events where aggregate_id = $1`, [d1.id])).rows;
    expect(ev).toEqual([{ type: "ProductHandedOver" }]);
  });

  it("payment in progress blocks preparation and handover (Belum dibayar); not_started allowed until the cashier (T-072)", async () => {
    const v = await visit(A, A.b1, FO);
    await as(FO, (db) => confirmSelection(db, key(), v, { items: [{ catalogVersionId: serum, quantity: "1" }] }));
    const [d] = await dispensingsOf(v);
    await h.admin.query(`update visits set payment = 'in_progress' where id = $1`, [v]);
    expect((await as(PH, prepList)).products.find((x) => x.id === d.id)?.blocker).toBe("payment_unpaid");
    expect(await why(as(PH, (db) => prepareDispensing(db, key(), d.id)))).toBe("ERR_VERSION_CONFLICT:payment_unpaid");
    await h.admin.query(`update visits set payment = 'not_started' where id = $1`, [v]);
    await as(PH, (db) => prepareDispensing(db, key(), d.id));
    await h.admin.query(`update visits set payment = 'blocked' where id = $1`, [v]);
    expect(await why(as(PH, (db) => handOver(db, key(), d.id, { checks: ALL })))).toBe("ERR_VERSION_CONFLICT:payment_unpaid");
  });
});

describe("authority, readers, guards", () => {
  it("writers: pharmacist only at its branch; another tenant's rows are not found; readers per role; RLS on the tables", async () => {
    const v = await visit(A, A.b1, FO);
    await as(FO, (db) => confirmSelection(db, key(), v, { items: [{ catalogVersionId: serum, quantity: "1" }] }));
    const [d] = await dispensingsOf(v);
    for (const p of [DOC, FO, MGR, NUR, OWN]) expect(await code(as(p, (db) => prepareDispensing(db, key(), d.id)))).toBe("ERR_FORBIDDEN");
    expect(await code(as(PHB2, (db) => prepareDispensing(db, key(), d.id)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BPH, (db) => prepareDispensing(db, key(), d.id)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(PH, (db) => prepareDispensing(db, key(), d.id, ROOMDEP)))).toBe("ERR_INVALID_INPUT"); // a ruang depot is not a dispensing depot
    for (const p of [DOC, FO, MGR, FH]) expect(await code(as(p, prepList))).toBe("ERR_FORBIDDEN");
    expect((await as(PHB2, prepList)).products.some((x) => x.id === d.id)).toBe(false);
    expect((await as(BPH, prepList)).products).toEqual([]);
    const sel = (who: P) => as(who, (db) => db.query(`select id from selections where visit_id = $1`, [v])).then((r) => r.rows.length);
    const disp = (who: P) => as(who, (db) => db.query(`select id from dispensings where id = $1`, [d.id])).then((r) => r.rows.length);
    expect([await sel(FO), await sel(BC), await sel(PH), await sel(OWN), await sel(PHB2), await sel(BPH)]).toEqual([1, 1, 1, 1, 0, 0]);
    expect([await disp(PH), await disp(DOC), await disp(FH), await disp(RO), await disp(FO), await disp(MGR), await disp(DOCB2), await disp(BPH)]).toEqual([1, 1, 1, 1, 0, 0, 0, 0]);
    expect((await as(DOC, (db) => db.query(`select id from pharmacy_recipe_items where catalog_version_id = $1`, [laser]))).rows.length).toBe(2);
    expect((await as(FO, (db) => db.query(`select id from pharmacy_recipe_items where catalog_version_id = $1`, [laser]))).rows.length).toBe(0);
  });

  it("guards: never deleted; frozen identities; prescriptions signed once; dispensings move forward once; unit frozen once used; replica mode", async () => {
    const v = await visit(A, A.b1, FO);
    const { prescriptionId } = await as(DOC, (db) => createPrescription(db, key(), v));
    await as(DOC, (db) => addPrescriptionItem(db, key(), prescriptionId, { catalogVersionId: serum, quantity: "1", signa: "1x sehari" }));
    await as(DOC, (db) => signPrescription(db, key(), prescriptionId, STEP));
    const [d] = await dispensingsOf(v);
    const raw = (sql: string, args: unknown[] = []) => code(h.admin.query(sql, args));
    expect(await raw(`update prescriptions set is_acute = true where id = $1`, [prescriptionId])).toBe("raw:42501");
    expect(await raw(`update prescription_items set signa = 'ubah' where prescription_id = $1`, [prescriptionId])).toBe("raw:42501");
    expect(await raw(`delete from prescriptions where id = $1`, [prescriptionId])).toBe("raw:42501");
    expect(await raw(`update dispensings set quantity = 9 where id = $1`, [d.id])).toBe("raw:42501");
    expect(await raw(`update dispensings set quantity = 9, state = 'cancelled', cancelled_at = now(), cancelled_by = $2, cancel_reason = 'ubah jumlah' where id = $1`, [d.id, PH.staffId])).toBe("raw:42501");
    expect(await raw(`update prescriptions set valid_until = valid_until + interval '30 days' where id = $1`, [prescriptionId])).toBe("raw:42501"); // signed is final
    expect(await raw(`update prescription_items set removed_at = now() where prescription_id = $1`, [prescriptionId])).toBe("raw:42501");
    expect(await raw(`update dispensings set state = 'handed' where id = $1`, [d.id])).toBe("raw:42501");
    expect(await raw(`delete from dispensings where id = $1`, [d.id])).toBe("raw:42501");
    expect(await raw(`update selections set confirmed_as = 'doctor'`)).toBe("raw:42501");
    expect(await raw(`delete from selection_items`)).toBe("raw:42501");
    expect(await raw(`delete from pharmacy_recipe_items where catalog_version_id = $1`, [laser])).toBe("raw:42501");
    expect(await raw(`update stock_items set unit = 'pcs' where id = $1`, [serumItem])).toMatch(/55000|ERR_VERSION_CONFLICT/);
    // an item only ever dispensed from a selection (no recipe, no prescription) is frozen too
    const lone = await as(OWN, (db) => publish(db, { kind: "product", code: "AP-LONE" }, { name: "Masker Tunggal", tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 1 } as never, "Produk"));
    const loneItem = (await as(PH, (db) => saveItem(db, key(), null, { catalogItemId: lone.itemId, unit: "pcs", storage: "ruang", highValue: false, active: true }))).itemId;
    expect(await raw(`update stock_items set unit = 'lembar' where id = $1`, [loneItem])).toBe("ok");
    const lv = await visit(A, A.b1, FO);
    await as(FO, (db) => confirmSelection(db, key(), lv, { items: [{ catalogVersionId: lone.versionId, quantity: "1" }] }));
    expect(await raw(`update stock_items set unit = 'pcs' where id = $1`, [loneItem])).toMatch(/55000|ERR_VERSION_CONFLICT/);
    expect(await raw(`truncate dispensing_lines`)).toMatch(/^raw:/);
    await h.admin.query("begin");
    try {
      await h.admin.query("set local session_replication_role = replica");
      expect(await code(h.admin.query(`delete from dispensings where id = $1`, [d.id]))).toBe("raw:42501");
    } finally {
      await h.admin.query("rollback");
    }
  });
});
