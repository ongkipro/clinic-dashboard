// T-064 Done-when: the four outcomes of scenario PR-14 — completed (counted), medical stop (not counted), clinic
// stop (not counted, front-office blocker), patient-chosen stop (counted; the performer and the actual materials are
// recorded). Plus the plan review: the start gate (treatment_start_check and payment) with its blockers; once per item
// per visit; people, room and material-request checks; the staged timer (forward only, pause excluded, the timer end
// changes nothing); the finish consumes every issued request of the item once (Bahan Tambahan included), refuses
// while one is open; replays; the visit's treatment step; TreatmentStarted / TreatmentFinished content-free with the
// session/commission contract; readers per role and branch; guards; cross-tenant. Synthetic data (MIG-2).
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { publish } from "../../src/modules/catalog/catalog";
import { captureConsent, consentText } from "../../src/modules/clinical/consent/consent";
import { addPlanItem, createPlan, openExam } from "../../src/modules/clinical/exam/exam";
import { signRecord, type StepUp } from "../../src/modules/clinical/records/records";
import { createDepot } from "../../src/modules/inventory/depots/depots";
import { issueMaterials, requestMaterials, wasteMaterials } from "../../src/modules/inventory/materials/materials";
import { receiveStock, saveItem } from "../../src/modules/inventory/stock";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import {
  advanceStage, blockersOf, finishTreatment, getTreatment, pauseTreatment, resumeTreatment, roomList, startTreatment, type StartInput,
} from "../../src/modules/treatment/treatment";
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

async function tenant(state = "live"): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ($1) returning id`, [state])).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Ruang Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
  return { tenantId, b1: await br("R1"), b2: await br("R2") };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`rng${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Ruang ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  if (!TENANT_WIDE.includes(role)) for (const b of branches.length ? branches : [t.b1]) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, tenantId: t.tenantId, role, branch: TENANT_WIDE.includes(role) ? undefined : branches[0] ?? t.b1 };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
const blocked = (x: Promise<unknown>) => x.then(() => [] as string[], (e) => blockersOf(e));
const key = () => crypto.randomUUID();
const day = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
function png(): Buffer {
  const b = Buffer.alloc(80);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(640, 16);
  b.writeUInt32BE(240, 20);
  return b;
}
async function credential(t: T, p: P, profession: "dokter" | "perawat", branch: string) {
  const permit = profession === "dokter" ? "sip" : "sipp";
  for (const [kind, b] of [["str", null], [permit, branch]] as const) {
    const id = (await h.admin.query(
      `insert into staff_credentials (tenant_id, staff_id, kind, number, issuer, profession, branch_id, valid_from, expires_on, recorded_by)
       values ($1, $2, $3, $4, 'Konsil Kesehatan', $5, $6, '2024-01-01', $7, $8) returning id`,
      [t.tenantId, p.staffId, kind, `NO-${++n}`, profession, b, b ? "2099-12-31" : null, OWN.staffId])).rows[0].id as string;
    await h.admin.query(`update staff_credentials set state = 'verified', decided_by = $2, decided_at = now() where id = $1`, [id, FH.staffId]);
  }
}
async function patient(t: T, branch: string): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, "");
  return (await h.admin.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation, education,
                           marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, 'Pasien Ruang', '1990-01-01', 'female', 'nik', $3, $4, 'islam', 'Karyawan', 's1', 'kawin', $2,
             (select s.id from staff s where s.tenant_id = $1 limit 1), 'fo_cashier') returning id`,
    [t.tenantId, branch, `v1.1.${id}.${id}.${id}`, (id + id).slice(0, 43)])).rows[0].id as string;
}
// A visit with a signed exam, one plan of `versions` (one item each) and an active consent.
async function ready(versions: string[], opts: { sign?: boolean; consent?: boolean } = {}) {
  const pid = await patient(A, A.b1);
  const v = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`,
    [A.tenantId, A.b1, pid, FO.staffId])).rows[0].id as string;
  const { examId } = await as(DOC, (db) => openExam(db, key(), v));
  const { planId } = await as(DOC, (db) => createPlan(db, key(), examId, "Program Ruang", "Kondisi uji"));
  const items: string[] = [];
  for (const ver of versions) items.push((await as(DOC, (db) => addPlanItem(db, key(), examId, planId, { stage: 1, catalog_version_id: ver, qty: 1 }))).itemId);
  if (opts.sign !== false) await as(DOC, (db) => signRecord(db, key(), examId, STEP));
  if (opts.consent !== false && opts.sign !== false) {
    const t = await as(DOC, (db) => consentText(db, v, planId));
    await as(DOC, (db) => captureConsent(db, key(), { visitId: v, planId, signer: "patient", expectedHash: t.content_hash, signature: png() }));
  }
  return { v, examId, planId, items };
}
const start = (who: P, v: string, s: Partial<StartInput> & { planItemId: string }, k = key()) =>
  as(who, (db) => startTreatment(db, k, v, { performerId: who.staffId, identityConfirmed: true, ...s }));
const exec = async (id: string) => (await h.admin.query(`select state, stage, outcome, counted, stop_reason, performer_staff_id from treatment_executions where id = $1`, [id])).rows[0];
const visitRow = async (v: string) => (await h.admin.query(`select treatment, blocker from visits where id = $1`, [v])).rows[0];

let A: T; let B: T;
let OWN: P; let FH: P; let DOC: P; let DOC2: P; let NUR: P; let TH: P; let FO: P; let PH: P; let MGR: P; let DOCB2: P; let BDOC: P;
let facial: string; let filler: string; let peel: string; let gel: string;
let ROOM: string; let ROOMDEP: string; let G1: string;

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 6 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant();
  B = await tenant();
  OWN = await person(A, "owner"); FH = await person(A, "facility_head", A.b1);
  DOC = await person(A, "doctor", A.b1); DOC2 = await person(A, "doctor", A.b1); NUR = await person(A, "nurse", A.b1); TH = await person(A, "therapist", A.b1);
  FO = await person(A, "fo_cashier", A.b1); PH = await person(A, "pharmacist", A.b1); MGR = await person(A, "manager", A.b1); DOCB2 = await person(A, "doctor", A.b2);
  BDOC = await person(B, "doctor", B.b1);
  await credential(A, DOC, "dokter", A.b1);
  await credential(A, DOC2, "dokter", A.b1);
  await credential(A, NUR, "perawat", A.b1);
  const svc = async (c: string, name: string, category: string, eligibility: unknown[]) => {
    const v = await as(OWN, (db) => publish(db, { kind: "service", code: c }, {
      name, tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 500_000, category, prep_min: 10, treatment_min: 30, buffer_min: 10,
      indications: "Indikasi", consent_template: `Templat persetujuan ${name}.`, delegation: "Dokter", aftercare_text: "Perawatan", eligibility,
    } as never, "Layanan baru"));
    if (v.approvalId) await as(FH, (db) => db.query(`select approval_decide($1, true, null)`, [v.approvalId]));
    return v.versionId;
  };
  facial = await svc("RG-FAC", "Facial Dasar", "facial", [{ role: "doctor", mode: "performs" }, { role: "nurse", mode: "performs" }, { role: "therapist", mode: "performs" }]);
  filler = await svc("RG-FIL", "Filler Asam Hialuronat", "filler", [{ role: "doctor", mode: "performs" }, { role: "nurse", mode: "assists" }]);
  peel = await svc("RG-PEL", "Peeling Ringan", "peeling_chemical", [{ role: "doctor", mode: "performs" }, { role: "nurse", mode: "supervised" }]);
  const gelCat = (await as(OWN, (db) => publish(db, { kind: "material", code: "RG-GEL" }, { name: "Gel Ruang", tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 1_000 } as never, "Bahan"))).itemId;
  gel = (await as(PH, (db) => saveItem(db, key(), null, { catalogItemId: gelCat, unit: "ml", storage: "ruang", highValue: false, active: true }))).itemId;
  G1 = (await h.admin.query(`select id from depots where branch_id = $1 and is_default`, [A.b1])).rows[0].id;
  ROOM = (await h.admin.query(`insert into rooms (tenant_id, branch_id, name, kind) values ($1, $2, 'Ruang Tindakan A', 'treatment') returning id`, [A.tenantId, A.b1])).rows[0].id;
  ROOMDEP = (await as(PH, (db) => createDepot(db, key(), { branchId: null, name: "Depot Ruang A", kind: "ruang", roomId: ROOM }))).depotId;
  await as(PH, (db) => receiveStock(db, key(), null, { itemId: gel, batchNo: "GR-1", expiry: day(200), quantity: "500", reason: "stok_awal" }));
}, 300_000);
afterAll(async () => {
  await app?.end();
  await owner?.end();
  await h?.close();
});

describe("scenario PR-14: four outcomes", () => {
  it("completed: counted; the actual materials are consumed once; the visit's treatment step is done", async () => {
    const s = await ready([facial]);
    const { requestId } = await as(NUR, (db) => requestMaterials(db, key(), { visitId: s.v, roomDepotId: ROOMDEP, planItemId: s.items[0], lines: [{ itemId: gel, quantity: "10" }] }));
    await as(PH, (db) => issueMaterials(db, key(), requestId, { fromDepotId: G1 }));
    const { executionId } = await start(NUR, s.v, { planItemId: s.items[0], materialRequestId: requestId });
    expect(await visitRow(s.v)).toEqual({ treatment: "in_progress", blocker: null });
    expect((await h.admin.query(`select room_id from treatment_executions where id = $1`, [executionId])).rows[0].room_id).toBe(ROOM); // from the request's room depot
    await as(NUR, (db) => finishTreatment(db, key(), executionId, { outcome: "completed", materials: { [requestId]: [{ itemId: gel, quantity: "7" }] } }));
    expect(await exec(executionId)).toMatchObject({ state: "finished", outcome: "completed", counted: true, stop_reason: null });
    const c = (await h.admin.query(`select sum(quantity)::float q from material_consumption_lines where request_id = $1`, [requestId])).rows[0].q;
    expect(c).toBe(7);
    expect(await visitRow(s.v)).toEqual({ treatment: "done", blocker: null });
  });

  it("medical stop: not counted; a reason is required; no front-office blocker", async () => {
    const s = await ready([facial]);
    const { executionId } = await start(NUR, s.v, { planItemId: s.items[0] });
    expect(await code(as(NUR, (db) => finishTreatment(db, key(), executionId, { outcome: "medical_stop" })))).toBe("ERR_INVALID_INPUT");
    expect(await code(as(NUR, (db) => finishTreatment(db, key(), executionId, { outcome: "completed", reason: "tidak perlu" })))).toBe("ERR_INVALID_INPUT");
    await as(NUR, (db) => finishTreatment(db, key(), executionId, { outcome: "medical_stop", reason: "Reaksi kulit, dihentikan" }));
    expect(await exec(executionId)).toMatchObject({ outcome: "medical_stop", counted: false, stop_reason: "Reaksi kulit, dihentikan" });
    expect(await visitRow(s.v)).toEqual({ treatment: "done", blocker: null });
  });

  it("clinic stop: not counted; the front office gets the blocker", async () => {
    const s = await ready([facial]);
    const { executionId } = await start(DOC, s.v, { planItemId: s.items[0] });
    await as(DOC, (db) => finishTreatment(db, key(), executionId, { outcome: "clinic_stop", reason: "Alat rusak" }));
    expect(await exec(executionId)).toMatchObject({ outcome: "clinic_stop", counted: false });
    expect(await visitRow(s.v)).toEqual({ treatment: "done", blocker: "Dihentikan klinik — jadwalkan ulang atau saldo" });
  });

  it("patient-chosen stop: counted; the performer and the actual materials are recorded", async () => {
    const s = await ready([facial]);
    const { requestId } = await as(NUR, (db) => requestMaterials(db, key(), { visitId: s.v, roomDepotId: ROOMDEP, planItemId: s.items[0], lines: [{ itemId: gel, quantity: "8" }] }));
    await as(PH, (db) => issueMaterials(db, key(), requestId, { fromDepotId: G1 }));
    const { executionId } = await start(NUR, s.v, { planItemId: s.items[0], performerId: DOC2.staffId, assistantId: NUR.staffId }); // the nurse records it; the doctor performed
    await as(NUR, (db) => finishTreatment(db, key(), executionId, { outcome: "patient_stop", reason: "Pasien memilih berhenti", materials: { [requestId]: [{ itemId: gel, quantity: "3" }] } }));
    expect(await exec(executionId)).toMatchObject({ outcome: "patient_stop", counted: true, performer_staff_id: DOC2.staffId });
    expect((await h.admin.query(`select sum(quantity)::float q from material_consumption_lines where request_id = $1`, [requestId])).rows[0].q).toBe(3);
    const ev = (await h.admin.query(`select type, payload from domain_events where aggregate_id = $1 order by occurred_at, id`, [executionId])).rows;
    expect(ev.map((e) => e.type)).toEqual(["TreatmentStarted", "TreatmentFinished"]);
    expect(ev[1].payload).toEqual({ execution_id: executionId, visit_id: s.v, plan_item_id: s.items[0], outcome: "patient_stop", counted: true, performer_id: DOC2.staffId });
  });
});

describe("the start gate (PR-11; open point 2; P2-1, P2-3)", () => {
  it("each blocker is reported; payment in progress blocks; identity must be confirmed", async () => {
    const unsigned = await ready([facial], { sign: false });
    expect(await blocked(start(NUR, unsigned.v, { planItemId: unsigned.items[0] }))).toEqual(expect.arrayContaining(["examination_unsigned", "consent_missing"]));
    const s = await ready([filler]);
    expect(await blocked(start(NUR, s.v, { planItemId: s.items[0] }))).toEqual(["not_eligible"]); // a nurse only assists a filler
    expect(await blocked(start(NUR, s.v, { planItemId: s.items[0], performerId: TH.staffId }))).toEqual(expect.arrayContaining(["credential_missing"]));
    await h.admin.query(`update visits set payment = 'in_progress' where id = $1`, [s.v]);
    expect(await blocked(start(DOC, s.v, { planItemId: s.items[0] }))).toEqual(["payment_unpaid"]);
    await h.admin.query(`update visits set payment = 'not_started' where id = $1`, [s.v]); // no cashier yet: allowed (DEC-074)
    expect(await code(start(DOC, s.v, { planItemId: s.items[0], identityConfirmed: false }))).toBe("ERR_INVALID_INPUT");
    expect(await code(start(DOC, s.v, { planItemId: s.items[0] }))).toBe("ok");
  });

  it("a supervised performer starts only with a credentialed doctor supervising", async () => {
    const s = await ready([peel]);
    expect(await blocked(start(NUR, s.v, { planItemId: s.items[0] }))).toEqual(["not_eligible"]); // supervised, no supervisor
    expect(await code(start(NUR, s.v, { planItemId: s.items[0], supervisorId: DOC.staffId }))).toBe("ok");
    expect((await h.admin.query(`select supervisor_staff_id from treatment_executions where visit_id = $1`, [s.v])).rows[0].supervisor_staff_id).toBe(DOC.staffId);
  });

  it("the actor's active branch: a visit of another branch is not found even for staff holding both branches", async () => {
    const both = await person(A, "nurse", A.b2, A.b1); // acting at b2, also assigned to b1
    const s = await ready([facial]);
    expect(await code(start(both, s.v, { planItemId: s.items[0] }))).toBe("ERR_NOT_FOUND");
    expect(await code(as(both, (db) => getTreatment(db, s.v)))).toBe("ERR_NOT_FOUND");
  });

  it("once per item per visit; people, room and material request checked; roles and branches", async () => {
    const s = await ready([facial]);
    expect(await code(start(NUR, s.v, { planItemId: s.items[0], assistantId: NUR.staffId }))).toBe("ERR_INVALID_INPUT");
    expect(await code(start(NUR, s.v, { planItemId: s.items[0], supervisorId: NUR.staffId }))).toBe("ERR_INVALID_INPUT");
    expect(await code(start(NUR, s.v, { planItemId: s.items[0], supervisorId: DOCB2.staffId }))).toBe("ERR_INVALID_INPUT");
    expect(await code(start(NUR, s.v, { planItemId: s.items[0], roomId: crypto.randomUUID() }))).toBe("ERR_INVALID_INPUT");
    const cons = (await h.admin.query(`insert into rooms (tenant_id, branch_id, name, kind) values ($1, $2, 'Konsul R', 'consultation') returning id`, [A.tenantId, A.b1])).rows[0].id;
    expect(await code(start(NUR, s.v, { planItemId: s.items[0], roomId: cons }))).toBe("ERR_INVALID_INPUT");
    const open = (await as(NUR, (db) => requestMaterials(db, key(), { visitId: s.v, roomDepotId: ROOMDEP, lines: [{ itemId: gel, quantity: "1" }] }))).requestId;
    expect(await code(start(NUR, s.v, { planItemId: s.items[0], materialRequestId: open }))).toBe("ERR_INVALID_INPUT"); // not issued
    for (const p of [FO, PH, MGR, OWN]) expect(await code(start(p, s.v, { planItemId: s.items[0], performerId: NUR.staffId }))).toBe("ERR_FORBIDDEN");
    expect(await code(start(DOCB2, s.v, { planItemId: s.items[0] }))).toBe("ERR_NOT_FOUND");
    expect(await code(start(BDOC, s.v, { planItemId: s.items[0] }))).toBe("ERR_NOT_FOUND");
    const k = key();
    const { executionId } = await start(NUR, s.v, { planItemId: s.items[0], supervisorId: DOC.staffId }, k);
    expect((await start(NUR, s.v, { planItemId: s.items[0], supervisorId: DOC.staffId }, k)).executionId).toBe(executionId); // replay
    expect(await code(start(DOC, s.v, { planItemId: s.items[0] }))).toBe("ERR_VERSION_CONFLICT");
    await as(NUR, (db) => finishTreatment(db, key(), executionId, { outcome: "medical_stop", reason: "Dihentikan dokter" }));
    expect(await code(start(DOC, s.v, { planItemId: s.items[0] }))).toBe("ERR_VERSION_CONFLICT"); // not again on this visit (P1-2)
  });
});

describe("staged timer (open point 3; P2-2)", () => {
  it("stages only forward while started; a pause is excluded on resume; finish from paused; the timer end changes nothing", async () => {
    const s = await ready([facial]);
    const { executionId: e } = await start(NUR, s.v, { planItemId: s.items[0] });
    await as(NUR, (db) => advanceStage(db, key(), e, "anesthesia"));
    expect(await code(as(NUR, (db) => advanceStage(db, key(), e, "preparation")))).toBe("ERR_INVALID_INPUT");
    expect(await code(as(NUR, (db) => advanceStage(db, key(), e, "anesthesia")))).toBe("ERR_INVALID_INPUT");
    const before = (await h.admin.query(`select stage_started_at from treatment_executions where id = $1`, [e])).rows[0].stage_started_at as Date;
    await as(NUR, (db) => pauseTreatment(db, key(), e));
    expect(await code(as(NUR, (db) => advanceStage(db, key(), e, "procedure")))).toBe("ERR_VERSION_CONFLICT");
    expect(await code(as(NUR, (db) => pauseTreatment(db, key(), e)))).toBe("ERR_VERSION_CONFLICT");
    await new Promise((r) => setTimeout(r, 1_100));
    await as(NUR, (db) => resumeTreatment(db, key(), e));
    const after = (await h.admin.query(`select stage_started_at, paused_at from treatment_executions where id = $1`, [e])).rows[0];
    expect(after.paused_at).toBeNull();
    expect(after.stage_started_at.getTime() - before.getTime()).toBeGreaterThanOrEqual(1_000); // shifted by the pause
    await as(NUR, (db) => advanceStage(db, key(), e, "recovery"));
    await as(NUR, (db) => pauseTreatment(db, key(), e));
    // the timer has no end: an hour later nothing changed
    expect((await exec(e)).state).toBe("paused");
    await as(NUR, (db) => finishTreatment(db, key(), e, { outcome: "completed" }));
    const evs = (await h.admin.query(`select kind, stage from treatment_execution_events where execution_id = $1 order by at, id`, [e])).rows.map((x) => x.stage ? `${x.kind}:${x.stage}` : x.kind);
    expect(evs).toEqual(["start", "stage:anesthesia", "pause", "resume", "stage:recovery", "pause", "finish"]);
  });
});

describe("materials at the finish (P1-1)", () => {
  it("Bahan Tambahan is a second request of the item, consumed at the finish too; an open request blocks the finish; replay consumes nothing more", async () => {
    const s = await ready([facial]);
    const r1 = (await as(NUR, (db) => requestMaterials(db, key(), { visitId: s.v, roomDepotId: ROOMDEP, planItemId: s.items[0], lines: [{ itemId: gel, quantity: "5" }] }))).requestId;
    await as(PH, (db) => issueMaterials(db, key(), r1, { fromDepotId: G1 }));
    const { executionId: e } = await start(NUR, s.v, { planItemId: s.items[0], materialRequestId: r1 });
    const r2 = (await as(NUR, (db) => requestMaterials(db, key(), { visitId: s.v, roomDepotId: ROOMDEP, planItemId: s.items[0], lines: [{ itemId: gel, quantity: "4" }] }))).requestId;
    expect(await code(as(NUR, (db) => finishTreatment(db, key(), e, { outcome: "completed" })))).toBe("ERR_VERSION_CONFLICT"); // r2 still open
    await as(PH, (db) => issueMaterials(db, key(), r2, { fromDepotId: G1 }));
    expect(await code(as(NUR, (db) => finishTreatment(db, key(), e, { outcome: "completed", materials: { [crypto.randomUUID()]: [] } })))).toBe("ERR_INVALID_INPUT");
    // a refused quantity keeps nothing (the key is not spent)
    const kq = key();
    expect(await code(as(NUR, (db) => finishTreatment(db, kq, e, { outcome: "completed", materials: { [r2]: [{ itemId: gel, quantity: "1e1" }] } })))).toBe("ERR_INVALID_INPUT");
    expect((await h.admin.query(`select count(*)::int n from idempotency_records where key = $1`, [kq])).rows[0].n).toBe(0);
    const k = key();
    await as(NUR, (db) => finishTreatment(db, k, e, { outcome: "completed", materials: { [r2]: [{ itemId: gel, quantity: "2" }] } }));
    const used = async (r: string) => Number((await h.admin.query(`select coalesce(sum(quantity), 0) q from material_consumption_lines where request_id = $1`, [r])).rows[0].q);
    expect([await used(r1), await used(r2)]).toEqual([5, 2]);
    const replay = await as(NUR, (db) => finishTreatment(db, k, e, { outcome: "completed", materials: { [r2]: [{ itemId: gel, quantity: "2" }] } }));
    expect(replay.replayed).toBe(true);
    expect([await used(r1), await used(r2)]).toEqual([5, 2]);
    expect(await code(as(NUR, (db) => finishTreatment(db, key(), e, { outcome: "completed" })))).toBe("ERR_VERSION_CONFLICT");
    expect((await h.admin.query(`select count(*)::int n from material_consumptions where request_id in ($1, $2)`, [r1, r2])).rows[0].n).toBe(2);
  });

  it("a request fully wasted during treatment is skipped at the finish; a request of another item is not taken", async () => {
    const s = await ready([facial, facial]);
    const mine = (await as(NUR, (db) => requestMaterials(db, key(), { visitId: s.v, roomDepotId: ROOMDEP, planItemId: s.items[0], lines: [{ itemId: gel, quantity: "2" }] }))).requestId;
    const other = (await as(NUR, (db) => requestMaterials(db, key(), { visitId: s.v, roomDepotId: ROOMDEP, planItemId: s.items[1], lines: [{ itemId: gel, quantity: "2" }] }))).requestId;
    await as(PH, (db) => issueMaterials(db, key(), mine, { fromDepotId: G1 }));
    await as(PH, (db) => issueMaterials(db, key(), other, { fromDepotId: G1 }));
    const { executionId: e } = await start(NUR, s.v, { planItemId: s.items[0] });
    await as(NUR, (db) => wasteMaterials(db, key(), mine, { reason: "Tumpah", lines: [{ itemId: gel, quantity: "2" }] }));
    await as(NUR, (db) => finishTreatment(db, key(), e, { outcome: "completed" }));
    expect((await h.admin.query(`select count(*)::int n from material_consumptions where request_id in ($1, $2)`, [mine, other])).rows[0].n).toBe(0);
    expect(await visitRow(s.v)).toMatchObject({ treatment: "done" });
  });
});

describe("readers, guards, tenants (open points 7, 8; P1-3, P3-1)", () => {
  it("room list and visit view for room roles at their branch; blocked visits listed; room data for the materials sheet", async () => {
    const s = await ready([facial], { sign: false });
    const list = await as(NUR, (db) => roomList(db));
    const row = list.visits.find((x) => x.visit_id === s.v)!;
    expect(row.items.map((i) => [i.name, i.execution])).toEqual([["Facial Dasar", null]]);
    const view = await as(TH, (db) => getTreatment(db, s.v));
    expect(view.items[0].blockers).toEqual(expect.arrayContaining(["examination_unsigned", "consent_missing"]));
    expect(view.items[0].performers.map((p) => p.staff_id)).toEqual(expect.arrayContaining([DOC.staffId, NUR.staffId, TH.staffId]));
    expect(view.items[0].performers.some((p) => p.staff_id === FO.staffId || p.staff_id === PH.staffId)).toBe(false);
    const f = await ready([filler]);
    const fv = await as(NUR, (db) => getTreatment(db, f.v));
    expect(fv.items[0].performers.map((p) => p.staff_id)).not.toContain(NUR.staffId); // a nurse only assists a filler
    expect(view.room_depots.map((d) => d.id)).toContain(ROOMDEP);
    expect(view.stock_items.map((i) => i.id)).toContain(gel);
    expect(view.rooms.map((r) => r.id)).toContain(ROOM);
    for (const p of [FO, PH, MGR, OWN]) expect(await code(as(p, (db) => roomList(db)))).toBe("ERR_FORBIDDEN");
    expect(await code(as(DOCB2, (db) => getTreatment(db, s.v)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BDOC, (db) => getTreatment(db, s.v)))).toBe("ERR_NOT_FOUND");
    expect((await h.admin.query(`select count(*)::int n from audit_events where object_id = $1 and reason_code = 'treatment_viewed'`, [s.v])).rows[0].n).toBeGreaterThan(0);
  });

  it("RLS on the tables; guards: never deleted, final once finished, identity frozen, events insert-only, replica mode", async () => {
    const s = await ready([facial]);
    const { executionId: e } = await start(NUR, s.v, { planItemId: s.items[0] });
    expect((await as(DOC, (db) => db.query(`select id from treatment_executions where id = $1`, [e]))).rows.length).toBe(1);
    expect((await as(DOCB2, (db) => db.query(`select id from treatment_executions where id = $1`, [e]))).rows.length).toBe(0);
    expect((await as(FO, (db) => db.query(`select id from treatment_execution_events where execution_id = $1`, [e]))).rows.length).toBe(0);
    const raw = (sql: string, args: unknown[] = []) => code(h.admin.query(sql, args));
    expect(await raw(`update treatment_executions set performer_staff_id = $2 where id = $1`, [e, DOC.staffId])).toBe("raw:42501");
    expect(await raw(`update treatment_executions set stage = 'preparation' where id = $1`, [e])).toBe("ok"); // the same stage: a no-op
    await as(NUR, (db) => advanceStage(db, key(), e, "procedure"));
    expect(await raw(`update treatment_executions set stage = 'anesthesia' where id = $1`, [e])).toBe("raw:42501");
    expect(await raw(`delete from treatment_executions where id = $1`, [e])).toBe("raw:42501");
    expect(await raw(`update treatment_execution_events set kind = 'pause' where execution_id = $1`, [e])).toBe("raw:42501");
    await as(NUR, (db) => finishTreatment(db, key(), e, { outcome: "completed" }));
    expect(await raw(`update treatment_executions set outcome = 'medical_stop', stop_reason = 'ubah' where id = $1`, [e])).toBe("raw:42501");
    expect(await raw(`update treatment_executions set state = 'started', finished_at = null, finished_by = null, finished_as = null, finish_command_key = null, outcome = null where id = $1`, [e])).toBe("raw:42501");
    expect(await raw(`truncate treatment_execution_events`)).toMatch(/^raw:/);
    await h.admin.query("begin");
    try {
      await h.admin.query("set local session_replication_role = replica");
      expect(await code(h.admin.query(`delete from treatment_executions where id = $1`, [e]))).toBe("raw:42501");
    } finally {
      await h.admin.query("rollback");
    }
  });
});
