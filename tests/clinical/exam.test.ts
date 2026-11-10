// T-052 Done-when: scenario PR-10 (a repeat patient's sheet shows two earlier visits, the photos placeholder
// and active plans in one read), CLIN-004 (the BC fact keeps its author; the verification is its own row
// with time and version), CLIN-012 (two parallel plans with their own items), and the BC/FO projection (items
// and prices only). Plus the plan review: authority before lookup, author-only drafts, RLS on the wall clock,
// guards, integers only, live prices, cautions after verification, events ids only, vendor class, cross-tenant.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { publish } from "../../src/modules/catalog/catalog";
import { setBranchPrice } from "../../src/modules/catalog/prices/prices";
import {
  addPlanItem, closePlan, createPlan, examQueue, examSheet, openExam, planOptions, removeMark, removePlanItem, saveExam, setMark, verifyFact,
} from "../../src/modules/clinical/exam/exam";
import { openIntake, patientCautions, saveIntake, sendIntake } from "../../src/modules/clinical/intake/intake";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { mergePatients } from "../../src/modules/patients/merge/merge";
import { createHarness, type Harness } from "../rls/harness";

process.env.DEPLOY_ENV = "local"; // synthetic data (MIG-2)

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let n = 0;
type T = { tenantId: string; b1: string; b2: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
const TENANT_WIDE = ["owner", "finance", "admin_pusat", "purchasing", "marketing", "central_cs", "auditor"];
const TABLES = ["examinations", "intake_verifications", "face_map_marks", "care_plans", "plan_items"];

async function tenant(state = "live"): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ($1) returning id`, [state])).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Pemeriksaan Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
  return { tenantId, b1: await br("E1"), b2: await br("E2") };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email) values ('X', $1) returning id`, [`pmr${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Pemeriksaan ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  const bs = TENANT_WIDE.includes(role) ? [] : branches.length ? branches : [t.b1];
  for (const b of bs) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, tenantId: t.tenantId, role, branch: bs[0] };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>, branch?: string) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: branch ?? p.branch }), fn);
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
const key = () => crypto.randomUUID();

async function patient(t: T, name = "Pasien Pemeriksaan"): Promise<string> {
  return (await h.admin.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation, education, marital_status, registered_branch_id, created_by, created_as)
     select $1, 'RM-' || lpad((count(*) + 1)::text, 6, '0'), $2, '1990-01-01', 'female', 'newborn_via_guardian', 'Fixture sintetis', 'islam', 'Karyawan', 's1', 'kawin', $3,
            (select s.id from staff s where s.tenant_id = $1 limit 1), 'fo_cashier' from patients where tenant_id = $1 returning id`,
    [t.tenantId, name, t.b1],
  )).rows[0].id as string;
}
// A walk-in visit (the database owner stands in for check-in, as T-047's tests); `ago` days in the past.
async function visit(t: T, patientId: string, branch = t.b1, ago = 0): Promise<string> {
  return (await h.admin.query(
    `insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by, checked_in_at)
     values ($1, $2, $3, 'walk_in', (select s.id from staff s where s.tenant_id = $1 limit 1), now() - make_interval(days => $4)) returning id`,
    [t.tenantId, branch, patientId, ago],
  )).rows[0].id as string;
}
const close = (v: string) => h.admin.query(`update visits set closed_at = checked_in_at + interval '1 hour', closed_by = checked_in_by where id = $1`, [v]);
// A visit with a sent intake by the BC; returns the visit, intake and fact ids by kind.
async function intakeVisit(t: T, bc: P, p: string, facts: { kind: string; value: string }[], ago = 0, branch = t.b1) {
  const v = await visit(t, p, branch, ago);
  const { intakeId } = await as(bc, (db) => openIntake(db, key(), v), branch);
  await as(bc, (db) => saveIntake(db, key(), intakeId, { complaint: `Keluhan ${ago}`, facts: facts as never }), branch);
  await as(bc, (db) => sendIntake(db, key(), intakeId), branch);
  const rows = (await h.admin.query(`select id, kind from intake_facts where intake_id = $1`, [intakeId])).rows;
  return { v, intakeId, fact: Object.fromEntries(rows.map((r) => [r.kind, r.id as string])) as Record<string, string> };
}
const audits = async (id: string) => (await h.admin.query(`select action, outcome, reason_code from audit_events where object_id = $1 order by seq`, [id])).rows;

let A: T;
let B: T;
let OWN: P; let BC: P; let DOC: P; let DOC2: P; let DOCB2: P; let NUR: P; let TH: P; let PH: P; let FH: P; let RO: P; let FO: P; let FIN: P; let MK: P;
let BDOC: P; let BBC: P;
let serum: { itemId: string; versionId: string };
let toner: { itemId: string; versionId: string };

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 6 });
  owner = new pg.Pool({ connectionString: h.ownerUrl(), max: 2 });
  owner.on("error", () => {});
  A = await tenant();
  B = await tenant();
  OWN = await person(A, "owner");
  BC = await person(A, "bc", A.b1);
  DOC = await person(A, "doctor", A.b1); DOC2 = await person(A, "doctor", A.b1); DOCB2 = await person(A, "doctor", A.b2);
  NUR = await person(A, "nurse", A.b1); TH = await person(A, "therapist", A.b1); PH = await person(A, "pharmacist", A.b1);
  FH = await person(A, "facility_head", A.b1); RO = await person(A, "records_officer", A.b1); FO = await person(A, "fo_cashier", A.b1);
  FIN = await person(A, "finance"); MK = await person(A, "marketing");
  BDOC = await person(B, "doctor", B.b1); BBC = await person(B, "bc", B.b1);
  const prod = async (c: string, name: string, price: number) => {
    const v = await as(OWN, (db) => publish(db, { kind: "product", code: c }, { name, tax_category: "taxable_goods", tax_basis: "Barang", normal_price: price }, "Produk"));
    return { itemId: v.itemId, versionId: v.versionId };
  };
  serum = await prod("EX-SRM", "Serum Cerah", 250_000);
  toner = await prod("EX-TNR", "Toner Lembut", 100_000);
}, 300_000);
afterAll(async () => {
  await app?.end();
  await owner?.end();
  await h?.close();
});

describe("scenario PR-10: a repeat patient's sheet in one read", () => {
  it("two earlier visits, the intake to verify, active plans and the photos placeholder state on one sheet", async () => {
    const p = await patient(A, "Sari Berulang");
    const e1 = await intakeVisit(A, BC, p, [{ kind: "allergy", value: "Amoksisilin" }], 30);
    const { examId: x1 } = await as(DOC, (db) => openExam(db, key(), e1.v));
    await as(DOC, (db) => saveExam(db, key(), x1, { assessment: "Akne vulgaris ringan", icd10_codes: ["L70.0"] }));
    const { planId } = await as(DOC, (db) => createPlan(db, key(), x1, "Program Jerawat", "Akne vulgaris"));
    await as(DOC, (db) => addPlanItem(db, key(), x1, planId, { stage: 1, catalog_version_id: serum.versionId, qty: 2 }));
    await close(e1.v);
    const e2 = await intakeVisit(A, BC, p, [{ kind: "skincare", value: "Sabun baru" }], 14);
    await close(e2.v);
    const e3 = await intakeVisit(A, BC, p, [{ kind: "medication", value: "Tidak ada" }], 0);
    const sheet = await as(DOC, (db) => examSheet(db, e3.v));
    expect(sheet.patient.name).toBe("Sari Berulang");
    expect(sheet.earlier.map((x) => x.visit_id)).toEqual([e2.v, e1.v]);
    expect(sheet.earlier[1]).toMatchObject({ assessment: "Akne vulgaris ringan", icd10_codes: ["L70.0"], complaint: "Keluhan 30" });
    expect(sheet.intake?.facts.map((f) => f.kind)).toContain("medication");
    expect(sheet.cautions).toEqual([expect.objectContaining({ value: "Amoksisilin", provenance: "bc_captured_unverified" })]);
    expect(sheet.plans).toHaveLength(1);
    expect(sheet.plans[0]).toMatchObject({ title: "Program Jerawat", condition: "Akne vulgaris", items: [expect.objectContaining({ name: "Serum Cerah", qty: 2, unit_price: 250_000, line_total: 500_000 })] });
    expect(sheet.examination).toBeNull();
    // One sheet read is one clinical-read audit row on the visit (no examination yet).
    expect((await audits(e3.v)).filter((r) => r.action === "clinical_read").map((r) => r.reason_code)).toEqual(["exam_viewed"]);
  });
});

describe("CLIN-004: the doctor verifies BC facts; the BC fact keeps its author", () => {
  it("confirm and correct are separate rows with time and version; the fact row never changes", async () => {
    const p = await patient(A, "Verifikasi");
    const e = await intakeVisit(A, BC, p, [{ kind: "allergy", value: "Kacang" }, { kind: "medication", value: "Vitamin C" }]);
    const before = (await h.admin.query(`select * from intake_facts where intake_id = $1 order by kind`, [e.intakeId])).rows;
    const { examId } = await as(DOC, (db) => openExam(db, key(), e.v));
    expect(await as(DOC, (db) => verifyFact(db, key(), examId, e.fact.medication, "confirmed"))).toMatchObject({ version: 1 });
    expect(await as(DOC, (db) => verifyFact(db, key(), examId, e.fact.allergy, "corrected", "Kacang tanah"))).toMatchObject({ version: 1 });
    // Same decision again: no new version; a changed decision raises it.
    expect(await as(DOC, (db) => verifyFact(db, key(), examId, e.fact.allergy, "corrected", "Kacang tanah"))).toMatchObject({ version: 1 });
    expect(await as(DOC, (db) => verifyFact(db, key(), examId, e.fact.allergy, "corrected", "Kacang tanah dan mete"))).toMatchObject({ version: 2 });
    expect((await h.admin.query(`select * from intake_facts where intake_id = $1 order by kind`, [e.intakeId])).rows).toEqual(before);
    const w = (await h.admin.query(`select fact_id, decision, corrected_value, version, verified_by, verified_at, provenance from intake_verifications where examination_id = $1 order by decision`, [examId])).rows;
    expect(w).toEqual([
      expect.objectContaining({ fact_id: e.fact.medication, decision: "confirmed", corrected_value: null, version: 1, verified_by: DOC.staffId, provenance: "clinician_verified" }),
      expect.objectContaining({ fact_id: e.fact.allergy, decision: "corrected", corrected_value: "Kacang tanah dan mete", version: 2, verified_by: DOC.staffId }),
    ]);
    expect(w.every((r) => r.verified_at instanceof Date)).toBe(true);
    // The sheet shows the BC fact with its own author, and the verification beside it.
    const s = await as(DOC, (db) => examSheet(db, e.v));
    expect(s.intake?.author_id).toBe(BC.staffId);
    expect(s.intake?.facts.find((f) => f.id === e.fact.allergy)).toMatchObject({ value: "Kacang", provenance: "bc_captured_unverified",
      verification: { decision: "corrected", corrected_value: "Kacang tanah dan mete", version: 2 } });
    // The caution now carries the doctor's value and provenance (patient_cautions re-created).
    expect(await as(NUR, (db) => patientCautions(db, p))).toEqual([expect.objectContaining({ factId: e.fact.allergy, value: "Kacang tanah dan mete", provenance: "clinician_verified" })]);
    // Bad decisions and facts outside the intake are refused.
    expect(await code(as(DOC, (db) => verifyFact(db, key(), examId, e.fact.allergy, "corrected")))).toBe("ERR_INVALID_INPUT");
    expect(await code(as(DOC, (db) => verifyFact(db, key(), examId, e.fact.allergy, "confirmed", "x")))).toBe("ERR_INVALID_INPUT");
    expect(await code(as(DOC, (db) => verifyFact(db, key(), examId, e.fact.allergy, "maybe" as never)))).toBe("ERR_INVALID_INPUT");
    const other = await intakeVisit(A, BC, await patient(A), [{ kind: "note", value: "Lain" }]);
    expect(await code(as(DOC, (db) => verifyFact(db, key(), examId, other.fact.note, "confirmed")))).toBe("ERR_NOT_FOUND");
  });

  it("a reviewed prior fact (from another branch, before a merge) is verifiable; an unsent intake is not", async () => {
    const old = await patient(A, "Duplikat Lama");
    const bcB2 = await person(A, "bc", A.b2);
    const prior = await intakeVisit(A, bcB2, old, [{ kind: "allergy", value: "Lateks" }], 20, A.b2);
    await close(prior.v);
    const p = await patient(A, "Duplikat Baru");
    await as(RO, (db) => mergePatients(db, key(), p, old, "Data ganda pasien yang sama"));
    const v = await visit(A, p);
    const { intakeId } = await as(BC, (db) => openIntake(db, key(), v));
    const { examId: early } = await as(DOC, (db) => openExam(db, key(), v));
    expect(await code(as(DOC, (db) => verifyFact(db, key(), early, prior.fact.allergy, "confirmed")))).toBe("ERR_VERSION_CONFLICT");
    await as(BC, (db) => saveIntake(db, key(), intakeId, { complaint: "Kontrol", facts: [{ kind: "allergy", same_as: prior.fact.allergy }] }));
    await as(BC, (db) => sendIntake(db, key(), intakeId));
    expect(await as(DOC, (db) => verifyFact(db, key(), early, prior.fact.allergy, "confirmed"))).toMatchObject({ version: 1 });
    const s = await as(DOC, (db) => examSheet(db, v));
    expect(s.intake?.facts.find((f) => f.id === prior.fact.allergy)).toMatchObject({ prior: true, verification: { decision: "confirmed" } });
    // The same fact verified again in a later examination: the caution follows the latest decision.
    await close(v);
    const v3 = await visit(A, p);
    const { intakeId: i3 } = await as(BC, (db) => openIntake(db, key(), v3));
    await as(BC, (db) => saveIntake(db, key(), i3, { complaint: "Kontrol lagi", facts: [{ kind: "allergy", same_as: prior.fact.allergy }] }));
    await as(BC, (db) => sendIntake(db, key(), i3));
    const { examId: later } = await as(DOC, (db) => openExam(db, key(), v3));
    await as(DOC, (db) => verifyFact(db, key(), later, prior.fact.allergy, "corrected", "Lateks alami"));
    expect(await as(NUR, (db) => patientCautions(db, p))).toEqual([expect.objectContaining({ value: "Lateks alami", provenance: "clinician_verified" })]);
  });
});

describe("CLIN-012: several active plans in parallel, each with its own items; live prices, never stored", () => {
  it("two plans for two conditions; items per plan and stage; removal and closing; the branch price applies live", async () => {
    const p = await patient(A, "Dua Program");
    const e = await intakeVisit(A, BC, p, [{ kind: "note", value: "Datang rutin" }]);
    const { examId } = await as(DOC, (db) => openExam(db, key(), e.v));
    const { planId: acne } = await as(DOC, (db) => createPlan(db, key(), examId, "Program Jerawat", "Akne vulgaris"));
    const { planId: flek } = await as(DOC, (db) => createPlan(db, key(), examId, "Program Flek", "Melasma"));
    const a1 = await as(DOC, (db) => addPlanItem(db, key(), examId, acne, { stage: 1, catalog_version_id: serum.versionId, qty: 1, dose_micro: 2_000_000, dose_unit: "ml", note: "Pagi hari" }));
    await as(DOC, (db) => addPlanItem(db, key(), examId, acne, { stage: 2, catalog_version_id: toner.versionId, qty: 3 }));
    await as(DOC, (db) => addPlanItem(db, key(), examId, flek, { stage: 1, catalog_version_id: toner.versionId, qty: 1 }));
    let s = await as(DOC, (db) => examSheet(db, e.v));
    expect(s.plans.map((x) => [x.title, x.condition, x.items.map((i) => `${i.stage}:${i.name}x${i.qty}=${i.line_total}`)])).toEqual([
      ["Program Jerawat", "Akne vulgaris", ["1:Serum Cerahx1=250000", "2:Toner Lembutx3=300000"]],
      ["Program Flek", "Melasma", ["1:Toner Lembutx1=100000"]],
    ]);
    expect(s.plans[0].items[0]).toMatchObject({ dose_micro: 2_000_000, dose_unit: "ml", note: "Pagi hari", examination_id: examId });
    // No price column anywhere in the plan tables; a branch price applies at once (live preview).
    const cols = (await h.admin.query(`select table_name, column_name from information_schema.columns where table_name in ('care_plans','plan_items') and column_name ~ 'price|total|amount|percent|progress'`)).rows;
    expect(cols).toEqual([]);
    await as(OWN, (db) => setBranchPrice(db, { itemId: toner.itemId, branchId: A.b1, price: 90_000, effectiveFrom: null, reason: "Harga khusus cabang" }));
    s = await as(DOC, (db) => examSheet(db, e.v));
    expect(s.plans[1].items[0]).toMatchObject({ unit_price: 90_000, line_total: 90_000 });
    // Removal is a timestamp (idempotent); a closed plan is final and leaves the sheet.
    await as(DOC, (db) => removePlanItem(db, key(), examId, a1.itemId));
    await as(DOC, (db) => removePlanItem(db, key(), examId, a1.itemId));
    expect((await h.admin.query(`select count(*)::int as n from plan_items where id = $1 and removed_at is not null`, [a1.itemId])).rows[0].n).toBe(1);
    await as(DOC, (db) => closePlan(db, key(), examId, flek, "completed"));
    expect(await code(as(DOC, (db) => addPlanItem(db, key(), examId, flek, { stage: 1, catalog_version_id: serum.versionId, qty: 1 })))).toBe("ERR_VERSION_CONFLICT");
    expect(await code(as(DOC, (db) => closePlan(db, key(), examId, flek, "stopped")))).toBe("ERR_VERSION_CONFLICT");
    s = await as(DOC, (db) => examSheet(db, e.v));
    expect(s.plans.map((x) => [x.title, x.items.length])).toEqual([["Program Jerawat", 1]]);
    expect((await h.admin.query(`select state, closed_exam_id from care_plans where id = $1`, [flek])).rows[0]).toEqual({ state: "completed", closed_exam_id: examId });
    // Bad items: a material, an unknown version, out-of-range numbers, half a dose, a float, an unknown key.
    const mat = await as(OWN, (db) => publish(db, { kind: "material", code: "EX-MAT" }, { name: "Kapas", tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 1_000 } as never, "Bahan"));
    for (const bad of [
      { stage: 1, catalog_version_id: mat.versionId, qty: 1 }, { stage: 1, catalog_version_id: crypto.randomUUID(), qty: 1 },
    ]) expect(await code(as(DOC, (db) => addPlanItem(db, key(), examId, acne, bad)))).toBe("ERR_NOT_FOUND");
    for (const bad of [
      { stage: 0, catalog_version_id: serum.versionId, qty: 1 }, { stage: 21, catalog_version_id: serum.versionId, qty: 1 },
      { stage: 1, catalog_version_id: serum.versionId, qty: 0 }, { stage: 1, catalog_version_id: serum.versionId, qty: 1.5 },
      { stage: 1, catalog_version_id: serum.versionId, qty: 1, dose_micro: 5 }, { stage: 1, catalog_version_id: serum.versionId, qty: 1, dose_micro: 0, dose_unit: "ml" },
      { stage: 1, catalog_version_id: serum.versionId, qty: 1, dose_micro: 1.5, dose_unit: "ml" }, { stage: 1, catalog_version_id: serum.versionId, qty: 1, price: 1 },
      { stage: 1, catalog_version_id: serum.versionId, qty: 1, dose_micro: 1, dose_unit: "tetes" },
    ]) expect(await code(as(DOC, (db) => addPlanItem(db, key(), examId, acne, bad as never))), JSON.stringify(bad)).toBe("ERR_INVALID_INPUT");
    expect(await code(as(DOC, (db) => createPlan(db, key(), examId, "ab", "Akne")))).toBe("ERR_INVALID_INPUT");
    // A plan of another patient is not found through this examination.
    const other = await intakeVisit(A, BC, await patient(A), [{ kind: "note", value: "x" }]);
    const { examId: ox } = await as(DOC2, (db) => openExam(db, key(), other.v));
    const { planId: op } = await as(DOC2, (db) => createPlan(db, key(), ox, "Program Lain", "Kusam"));
    expect(await code(as(DOC, (db) => addPlanItem(db, key(), examId, op, { stage: 1, catalog_version_id: serum.versionId, qty: 1 })))).toBe("ERR_NOT_FOUND");
    // Removing another patient's item, or an item of a closed plan, through this examination is refused.
    const { itemId: oi } = await as(DOC2, (db) => addPlanItem(db, key(), ox, op, { stage: 1, catalog_version_id: serum.versionId, qty: 1 }));
    expect(await code(as(DOC, (db) => removePlanItem(db, key(), examId, oi)))).toBe("ERR_NOT_FOUND");
    const flekItem = (await h.admin.query(`select id from plan_items where plan_id = $1`, [flek])).rows[0].id as string;
    expect(await code(as(DOC, (db) => removePlanItem(db, key(), examId, flekItem)))).toBe("ERR_VERSION_CONFLICT");
    expect((await h.admin.query(`select count(*)::int as n from plan_items where id = any($1::uuid[]) and removed_at is not null`, [[oi, flekItem]])).rows[0].n).toBe(0);
    // Only completed or stopped close a plan.
    for (const bad of ["active", "paused"]) expect(await code(as(DOC, (db) => closePlan(db, key(), examId, acne, bad as never)))).toBe("ERR_INVALID_INPUT");
  });
});

describe("the plan projection: BC, FO, nurse and therapist see items and prices only", () => {
  it("plan_options carries no condition, dose, note or anything of the examination; others are refused", async () => {
    const p = await patient(A, "Proyeksi");
    const e = await intakeVisit(A, BC, p, [{ kind: "note", value: "x" }]);
    const { examId } = await as(DOC, (db) => openExam(db, key(), e.v));
    await as(DOC, (db) => saveExam(db, key(), examId, { assessment: "Diagnosis rahasia", icd10_codes: ["L81.4"] }));
    const { planId } = await as(DOC, (db) => createPlan(db, key(), examId, "Program Cerah", "Melasma rahasia"));
    await as(DOC, (db) => addPlanItem(db, key(), examId, planId, { stage: 1, catalog_version_id: serum.versionId, qty: 2, dose_micro: 1_000_000, dose_unit: "ml", note: "Catatan rahasia" }));
    for (const who of [BC, FO, NUR, TH, DOC]) {
      const o = await as(who, (db) => planOptions(db, e.v));
      expect(o.plans).toHaveLength(1);
      expect(Object.keys(o.plans[0]).sort()).toEqual(["created_at", "id", "items", "state", "title"]);
      expect(Object.keys(o.plans[0].items[0]).sort()).toEqual(["id", "item_id", "kind", "line_total", "name", "qty", "stage", "unit_price", "version_id"]);
      expect(o.plans[0].items[0]).toMatchObject({ qty: 2, unit_price: 250_000, line_total: 500_000 });
      expect(JSON.stringify(o)).not.toMatch(/rahasia|L81|dose|1000000/);
    }
    for (const who of [PH, FIN, MK, OWN, FH, RO, DOCB2]) expect(await code(as(who, (db) => planOptions(db, e.v))), who.role).toBe("ERR_NOT_FOUND");
    // BC, FO, nurse and therapist have no direct read on any examination table.
    for (const who of [BC, FO, NUR, TH, PH]) {
      for (const t of TABLES) expect(await as(who, async (db) => (await db.query(`select count(*)::int as n from ${t}`)).rows[0].n), `${who.role} ${t}`).toBe(0);
    }
  });
});

describe("the examination: SOAP, templates, vitals, ICD-10, face map", () => {
  it("saves the allowlisted fields; Fitzpatrick and scales are allowed to the doctor; bad values are refused", async () => {
    const e = await intakeVisit(A, BC, await patient(A), [{ kind: "note", value: "x" }]);
    const { examId } = await as(DOC, (db) => openExam(db, key(), e.v));
    await as(DOC, (db) => saveExam(db, key(), examId, {
      subjective: " Gatal ", objective: "Papul eritem", assessment: "Akne", plan_note: "Kontrol 2 minggu", template_key: "jerawat",
      template_values: { fitzpatrick: "IV", lesi_inflamasi: "12", derajat: "sedang" }, vitals: { td_sistolik: 120, nadi: 80 }, icd10_codes: ["L70.0", "L70.0", "B35.1"],
    }));
    const r = (await h.admin.query(`select subjective, template_key, template_values, vitals, icd10_codes from examinations where id = $1`, [examId])).rows[0];
    expect(r).toEqual({ subjective: "Gatal", template_key: "jerawat", template_values: { fitzpatrick: "IV", lesi_inflamasi: "12", derajat: "sedang" },
      vitals: { td_sistolik: 120, nadi: 80 }, icd10_codes: ["B35.1", "L70.0"] });
    // Absent keys stay; null clears a section.
    await as(DOC, (db) => saveExam(db, key(), examId, { objective: null }));
    expect((await h.admin.query(`select subjective, objective from examinations where id = $1`, [examId])).rows[0]).toEqual({ subjective: "Gatal", objective: null });
    await as(DOC, (db) => saveExam(db, key(), examId, { objective: "Komedo terbuka" }));
    await as(DOC, (db) => saveExam(db, key(), examId, { plan_note: "Kontrol" }));
    expect((await h.admin.query(`select objective, plan_note, template_key, icd10_codes from examinations where id = $1`, [examId])).rows[0])
      .toEqual({ objective: "Komedo terbuka", plan_note: "Kontrol", template_key: "jerawat", icd10_codes: ["B35.1", "L70.0"] });
    for (const bad of [
      { template_values: { fitzpatrick: "VII" } }, { template_values: { skor: "3" } }, { template_key: "lainnya" }, { template_key: null },
      { vitals: { nadi: 500 } }, { vitals: { nadi: 80.5 } }, { vitals: { gula: 100 } }, { vitals: { nadi: "80" } },
      { icd10_codes: ["l70"] }, { icd10_codes: Array.from({ length: 11 }, (_, i) => `L${10 + i}`) }, { icd10_codes: "L70" },
      { color: "x" }, { assessment: "x".repeat(4001) }, { assessment: 3 },
    ]) expect(await code(as(DOC, (db) => saveExam(db, key(), examId, bad as never))), JSON.stringify(bad).slice(0, 60)).toBe("ERR_INVALID_INPUT");
  });

  it("marks: four templates, permille integers, tindakan carries a dose (and optionally a version); removal while a draft", async () => {
    const e = await intakeVisit(A, BC, await patient(A), [{ kind: "note", value: "x" }]);
    const { examId } = await as(DOC, (db) => openExam(db, key(), e.v));
    const ids: string[] = [];
    for (const t of ["face_front", "face_left", "face_right", "body"] as const) {
      ids.push((await as(DOC, (db) => setMark(db, key(), examId, { template: t, layer: "keluhan", x: 0, y: 1000, label: `Titik ${t}` }))).markId);
    }
    ids.push((await as(DOC, (db) => setMark(db, key(), examId, { template: "face_front", layer: "tindakan", x: 512, y: 300, label: "Dahi",
      catalog_version_id: serum.versionId, dose_micro: 4_000_000, dose_unit: "unit" }))).markId);
    const s = await as(DOC, (db) => examSheet(db, e.v));
    expect(s.examination?.marks).toHaveLength(5);
    expect(s.examination?.marks[4]).toEqual({ id: ids[4], template: "face_front", layer: "tindakan", x: 512, y: 300, label: "Dahi", catalog_version_id: serum.versionId, dose_micro: 4_000_000, dose_unit: "unit" });
    for (const bad of [
      { template: "face_front", layer: "keluhan", x: 1001, y: 0, label: "a" }, { template: "face_front", layer: "keluhan", x: -1, y: 0, label: "a" },
      { template: "face_front", layer: "keluhan", x: 0.5, y: 0, label: "a" }, { template: "kaki", layer: "keluhan", x: 1, y: 1, label: "a" },
      { template: "face_front", layer: "tindakan", x: 1, y: 1, label: "a" }, { template: "face_front", layer: "keluhan", x: 1, y: 1, label: "a", dose_micro: 1, dose_unit: "ml" },
      { template: "face_front", layer: "tindakan", x: 1, y: 1, label: "a", dose_micro: 1_000_000_001, dose_unit: "ml" },
      { template: "face_front", layer: "pemeriksaan", x: 1, y: 1, label: "a", catalog_version_id: serum.versionId },
      { template: "face_front", layer: "keluhan", x: 1, y: 1, label: " " }, { template: "face_front", layer: "keluhan", x: 1, y: 1, label: "a", warna: "merah" },
    ]) expect(await code(as(DOC, (db) => setMark(db, key(), examId, bad as never))), JSON.stringify(bad)).toBe("ERR_INVALID_INPUT");
    await as(DOC, (db) => removeMark(db, key(), examId, ids[0]));
    expect(await code(as(DOC, (db) => removeMark(db, key(), examId, ids[0])))).toBe("ERR_NOT_FOUND");
    expect((await h.admin.query(`select count(*)::int as n from face_map_marks where examination_id = $1`, [examId])).rows[0].n).toBe(4);
    // The version is marked referenced (CLIN-011): a fresh product referenced only by this mark.
    const filler = (await as(OWN, (db) => publish(db, { kind: "product", code: "EX-FIL" }, { name: "Filler HA", tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 3_000_000 }, "Produk"))).versionId;
    expect((await h.admin.query(`select referenced_at from catalog_versions where id = $1`, [filler])).rows[0].referenced_at).toBeNull();
    await as(DOC, (db) => setMark(db, key(), examId, { template: "face_left", layer: "tindakan", x: 300, y: 600, label: "Pipi", catalog_version_id: filler, dose_micro: 500_000, dose_unit: "ml" }));
    expect((await h.admin.query(`select referenced_at is not null as r from catalog_versions where id = $1`, [filler])).rows[0].r).toBe(true);
    expect(await code(as(DOC, (db) => setMark(db, key(), examId, { template: "face_left", layer: "tindakan", x: 1, y: 1, label: "a", catalog_version_id: crypto.randomUUID(), dose_micro: 1, dose_unit: "ml" })))).toBe("ERR_NOT_FOUND");
  });
});

describe("authority, lifecycle and the visit step", () => {
  it("a non-doctor is refused before any lookup; one examination per visit; only the author edits", async () => {
    const e = await intakeVisit(A, BC, await patient(A), [{ kind: "note", value: "x" }]);
    for (const who of [BC, NUR, TH, PH, FH, RO, FO, OWN]) {
      expect(await code(as(who, (db) => openExam(db, key(), crypto.randomUUID()))), who.role).toBe("ERR_FORBIDDEN");
      expect(await code(as(who, (db) => saveExam(db, key(), crypto.randomUUID(), {}))), who.role).toBe("ERR_FORBIDDEN");
    }
    const { examId } = await as(DOC, (db) => openExam(db, key(), e.v));
    expect((await h.admin.query(`select doctor from visits where id = $1`, [e.v])).rows[0].doctor).toBe("in_progress");
    expect((await as(DOC2, (db) => openExam(db, key(), e.v))).examId).toBe(examId);
    for (const op of [
      (db: pg.PoolClient) => saveExam(db, key(), examId, { assessment: "x" }),
      (db: pg.PoolClient) => setMark(db, key(), examId, { template: "body", layer: "keluhan", x: 1, y: 1, label: "a" }),
      (db: pg.PoolClient) => createPlan(db, key(), examId, "Program", "Kondisi"),
      (db: pg.PoolClient) => verifyFact(db, key(), examId, e.fact.note, "confirmed"),
    ]) expect(await code(as(DOC2, op))).toBe("ERR_FORBIDDEN");
    // Another branch's doctor does not find the visit or the examination.
    expect(await code(as(DOCB2, (db) => openExam(db, key(), e.v)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(DOCB2, (db) => saveExam(db, key(), examId, {})))).toBe("ERR_NOT_FOUND");
    // A closed visit refuses; a tenant in exit refuses the writers.
    await close(e.v);
    expect(await code(as(DOC, (db) => saveExam(db, key(), examId, { assessment: "x" })))).toBe("ERR_VERSION_CONFLICT");
    expect(await code(as(DOC, (db) => openExam(db, key(), e.v)))).toBe("ERR_VERSION_CONFLICT");
    const X = await tenant("exit");
    const xd = await person(X, "doctor", X.b1);
    expect(await code(as(xd, (db) => openExam(db, key(), crypto.randomUUID())))).toBe("ERR_TENANT_SUSPENDED");
  });

  it("idempotent commands replay; a non-draft examination freezes its parts; guards and triggers always enabled", async () => {
    const e = await intakeVisit(A, BC, await patient(A), [{ kind: "note", value: "x" }]);
    const k = key();
    const o1 = await as(DOC, (db) => openExam(db, k, e.v));
    expect(await as(DOC, (db) => openExam(db, k, e.v))).toEqual({ examId: o1.examId, replayed: true });
    const examId = o1.examId;
    const { markId } = await as(DOC, (db) => setMark(db, key(), examId, { template: "body", layer: "keluhan", x: 1, y: 1, label: "a" }));
    const { planId } = await as(DOC, (db) => createPlan(db, key(), examId, "Program", "Kondisi"));
    const { itemId } = await as(DOC, (db) => addPlanItem(db, key(), examId, planId, { stage: 1, catalog_version_id: serum.versionId, qty: 1 }));
    await as(DOC, (db) => verifyFact(db, key(), examId, e.fact.note, "confirmed"));
    await expect(h.admin.query(`delete from examinations where id = $1`, [examId])).rejects.toThrow(/never deleted/);
    await expect(h.admin.query(`update examinations set author_id = $2 where id = $1`, [examId, DOC2.staffId])).rejects.toThrow(/keeps its visit/);
    await expect(h.admin.query(`insert into examinations (tenant_id, branch_id, visit_id, patient_id, author_id, state) select tenant_id, branch_id, gen_random_uuid(), patient_id, author_id, 'signed' from examinations where id = $1`, [examId])).rejects.toThrow();
    await expect(h.admin.query(`delete from intake_verifications where examination_id = $1`, [examId])).rejects.toThrow(/never deleted/);
    await expect(h.admin.query(`update intake_verifications set fact_id = gen_random_uuid() where examination_id = $1`, [examId])).rejects.toThrow(/keeps its examination/);
    await expect(h.admin.query(`update face_map_marks set x = 2 where id = $1`, [markId])).rejects.toThrow(/replaced/);
    await expect(h.admin.query(`delete from care_plans where id = $1`, [planId])).rejects.toThrow(/never deleted/);
    await expect(h.admin.query(`update care_plans set title = 'Lain' where id = $1`, [planId])).rejects.toThrow(/keeps its patient/);
    await expect(h.admin.query(`update plan_items set qty = 5 where id = $1`, [itemId])).rejects.toThrow(/only by removal/);
    await expect(h.admin.query(`delete from plan_items where id = $1`, [itemId])).rejects.toThrow(/never deleted/);
    // A signed examination (T-053 signs through record_sign; here the database owner stands in) freezes the
    // examination and its parts.
    {
      await h.admin.query(`update examinations set state = 'signed', signed_at = now(), signed_by = author_id, signed_as = 'doctor', content_hash = repeat('a', 64) where id = $1`, [examId]);
      await expect(h.admin.query(`update examinations set assessment = 'x' where id = $1`, [examId])).rejects.toThrow(/signed examination is final/);
      await expect(h.admin.query(`delete from face_map_marks where id = $1`, [markId])).rejects.toThrow(/signed examination is final/);
      await expect(h.admin.query(`update intake_verifications set decision = 'corrected', corrected_value = 'y' where examination_id = $1`, [examId])).rejects.toThrow(/signed examination is final/);
      expect(await code(as(DOC, (db) => saveExam(db, key(), examId, { assessment: "x" })))).toBe("ERR_VERSION_CONFLICT");
    }
    for (const t of TABLES) await expect(h.admin.query(`truncate ${t} cascade`)).rejects.toThrow();
    const trig = (await h.admin.query(`select tgname, tgenabled from pg_trigger where tgrelid = any($1::regclass[]) and not tgisinternal order by 1`, [TABLES])).rows;
    expect(trig.map((r) => `${r.tgname}:${r.tgenabled}`)).toEqual([
      "care_plans_guard:A", "care_plans_no_truncate:A", "examinations_guard:A", "examinations_no_truncate:A", "face_map_marks_guard:A", "face_map_marks_no_truncate:A",
      "intake_verifications_guard:A", "intake_verifications_no_truncate:A", "plan_items_guard:A", "plan_items_no_truncate:A"]);
  });

  it("audit and events carry ids and codes only", async () => {
    const e = await intakeVisit(A, BC, await patient(A), [{ kind: "allergy", value: "Udang" }]);
    const { examId } = await as(DOC, (db) => openExam(db, key(), e.v));
    await as(DOC, (db) => saveExam(db, key(), examId, { assessment: "Rahasia klinis" }));
    await as(DOC, (db) => verifyFact(db, key(), examId, e.fact.allergy, "corrected", "Udang galah"));
    const { planId } = await as(DOC, (db) => createPlan(db, key(), examId, "Program Rahasia", "Kondisi rahasia"));
    await as(DOC, (db) => addPlanItem(db, key(), examId, planId, { stage: 1, catalog_version_id: serum.versionId, qty: 1 }));
    await as(DOC, (db) => closePlan(db, key(), examId, planId, "stopped"));
    expect((await audits(examId)).map((r) => r.reason_code)).toEqual(["examination_opened", "examination_saved", "intake_verified"]);
    expect((await audits(planId)).map((r) => r.reason_code)).toEqual(["plan_created", "plan_item_added", "plan_stopped"]);
    const ev = (await h.admin.query(`select type, payload from domain_events where aggregate_id = any($1::uuid[]) order by occurred_at, id`, [[examId, planId]])).rows;
    expect(ev.map((x) => x.type)).toEqual(["ExaminationOpened", "IntakeVerified", "CarePlanCreated", "CarePlanUpdated", "CarePlanClosed"]);
    expect(JSON.stringify(ev)).not.toMatch(/rahasia|Udang/i);
    expect(Object.keys(ev[1].payload).sort()).toEqual(["change", "decision", "examination_id", "fact_id"]);
  });
});

describe("readers on the wall clock (plan P1-4)", () => {
  it("doctor, facility head and records officer read at their branch; the queue; the role removed loses the read", async () => {
    const e = await intakeVisit(A, BC, await patient(A, "Antrean Dokter"), [{ kind: "allergy", value: "Debu" }]);
    const { examId } = await as(DOC, (db) => openExam(db, key(), e.v));
    const rows = (who: P) => as(who, async (db) => (await db.query(`select count(*)::int as n from examinations where id = $1`, [examId])).rows[0].n as number);
    for (const who of [DOC, DOC2, FH, RO]) expect(await rows(who)).toBe(1);
    for (const who of [BC, NUR, TH, PH, FO, FIN, MK, OWN, DOCB2]) expect(await rows(who)).toBe(0);
    for (const who of [FH, RO]) expect((await as(who, (db) => examSheet(db, e.v))).examination?.id).toBe(examId);
    for (const who of [BC, NUR, FO, DOCB2]) expect(await code(as(who, (db) => examSheet(db, e.v))), who.role).toBe("ERR_NOT_FOUND");
    const q = await as(DOC, (db) => examQueue(db, A.b1));
    expect(q.visits.find((x) => x.id === e.v)).toMatchObject({ patient_name: "Antrean Dokter", intake_state: "sent", exam_id: examId, author_id: DOC.staffId, cautions: 1 });
    for (const who of [BC, FO, NUR]) expect(await code(as(who, (db) => examQueue(db, A.b1)))).toBe("ERR_FORBIDDEN");
    expect(await code(as(DOC, (db) => examQueue(db, A.b2)))).toBe("ERR_NOT_FOUND");
    const d = await person(A, "doctor", A.b1);
    const ctx = await resolveContext(app, d.acc, { tenantId: A.tenantId, actingRole: "doctor", activeBranchId: A.b1 });
    await h.admin.query(`delete from staff_branches where staff_id = $1`, [d.staffId]);
    expect(await withTenantContext(app, ctx, async (db) => (await db.query(`select count(*)::int as n from examinations where id = $1`, [examId])).rows[0].n)).toBe(0);
  });

  it("vendor class clinical; helpers not executable; cross-tenant reads and writes nothing", async () => {
    const kinds = (await h.admin.query(`select support_class from support_object_kinds where table_name = any($1::text[])`, [TABLES.map((t) => `public.${t}`)])).rows;
    expect(kinds.map((k) => k.support_class)).toEqual(Array(5).fill("clinical"));
    for (const f of ["examinations_guard()", "exam_parts_guard()", "plans_guard()", "exam_actor()", "exam_draft(uuid)", "exam_changed(uuid,text,text,uuid,text,jsonb)",
      "exam_version(uuid,uuid,text[])", "exam_plan(examinations,uuid)", "exam_plans_json(uuid,uuid,uuid,boolean)", "exam_cautions(uuid,uuid)"]) {
      for (const r of ["clinic_app", "clinic_vendor", "clinic_operator"]) {
        expect((await h.admin.query(`select has_function_privilege($1, $2, 'execute') as ok`, [r, `public.${f}`])).rows[0].ok, `${r} ${f}`).toBe(false);
      }
    }
    for (const t of ["exam_template_fields", "exam_vital_ranges"]) {
      expect((await h.admin.query(`select has_table_privilege('clinic_app', $1, 'select') as ok`, [`public.${t}`])).rows[0].ok).toBe(false);
    }
    const e = await intakeVisit(A, BC, await patient(A), [{ kind: "note", value: "x" }]);
    const { examId } = await as(DOC, (db) => openExam(db, key(), e.v));
    const { planId } = await as(DOC, (db) => createPlan(db, key(), examId, "Program", "Kondisi"));
    for (const t of TABLES) expect(await as(BDOC, async (db) => (await db.query(`select count(*)::int as n from ${t}`)).rows[0].n)).toBe(0);
    expect(await code(as(BDOC, (db) => openExam(db, key(), e.v)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BDOC, (db) => saveExam(db, key(), examId, {})))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BDOC, (db) => examSheet(db, e.v)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BBC, (db) => planOptions(db, e.v)))).toBe("ERR_NOT_FOUND");
    const bv = await visit(B, await patient(B));
    const { examId: bx } = await as(BDOC, (db) => openExam(db, key(), bv));
    expect(await code(as(BDOC, (db) => addPlanItem(db, key(), bx, planId, { stage: 1, catalog_version_id: serum.versionId, qty: 1 })))).toBe("ERR_NOT_FOUND");
  });
});
