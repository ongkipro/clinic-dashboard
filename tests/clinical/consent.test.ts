// T-054 Done-when: scenario PR-11 (consent for 20 units, the plan raised to 25 → treatment cannot start until new
// consent is recorded), CLIN-005 (a missing credential blocks start), CLIN-022 (an added item or a higher dose
// needs re-consent). Plus the plan review: text and hash, guardian, supersession and withdrawal, eligibility
// (named row, floor, assists, supervised, products), contraindication reviews, readers, guards, signature hidden,
// audit and events content-free, cross-tenant.
import { createHash } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { publish } from "../../src/modules/catalog/catalog";
import {
  assertCanStart, captureConsent, checkTreatmentStart, consentPage, consentQueue, consentSignature, consentText, reviewContraindication, withdrawConsent,
} from "../../src/modules/clinical/consent/consent";
import { addPlanItem, createPlan, openExam, removePlanItem } from "../../src/modules/clinical/exam/exam";
import { signRecord } from "../../src/modules/clinical/records/records";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { createHarness, type Harness, testPool } from "../rls/harness";

process.env.DEPLOY_ENV = "local"; // synthetic data (MIG-2)

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let n = 0;
type T = { tenantId: string; b1: string; b2: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
const TENANT_WIDE = ["owner", "finance", "admin_pusat", "purchasing", "marketing", "central_cs", "auditor"];
const TABLES = ["procedure_consents", "procedure_consent_items", "contraindication_reviews"];
const STEP = { verified: true } as const;

// A PNG of a given size (header only; the sniffer and the database check signature, IHDR and size).
function png(w = 640, hgt = 240, salt = 0): Buffer {
  const b = Buffer.alloc(80 + salt);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(hgt, 20);
  return b;
}

async function tenant(state = "live"): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ($1) returning id`, [state])).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Persetujuan Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
  return { tenantId, b1: await br("C1"), b2: await br("C2") };
}
async function person(t: T, roles: Role | Role[], ...branches: string[]): Promise<P> {
  const rs = Array.isArray(roles) ? roles : [roles];
  const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`csn${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Persetujuan ${n}` });
  for (const role of rs) {
    const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
    if (!TENANT_WIDE.includes(role)) for (const b of branches.length ? branches : [t.b1]) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  }
  return { acc, staffId, tenantId: t.tenantId, role: rs[0], branch: TENANT_WIDE.includes(rs[0]) ? undefined : branches[0] ?? t.b1 };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>, role?: Role) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: role ?? p.role, activeBranchId: p.branch }), fn);
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
const reason = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e as { reason?: string }).reason ?? (e as Error).message);
const key = () => crypto.randomUUID();

// A verified STR + branch permit for a staff member (pending as recorded, then verified by another person).
async function credential(t: T, p: P, profession: "dokter" | "perawat", branch: string, expires = "2099-12-31", validFrom = "2024-01-01") {
  const by = OWN.staffId;
  const permit = profession === "dokter" ? "sip" : "sipp";
  for (const [kind, b, exp] of [["str", null, null], [permit, branch, expires]] as const) {
    const id = (await h.admin.query(
      `insert into staff_credentials (tenant_id, staff_id, kind, number, issuer, profession, branch_id, valid_from, expires_on, recorded_by)
       values ($1, $2, $3, $4, 'Konsil Kesehatan', $5, $6, $7, $8, $9) returning id`,
      [t.tenantId, p.staffId, kind, `NO-${++n}`, profession, b, validFrom, exp, by])).rows[0].id as string;
    await h.admin.query(`update staff_credentials set state = 'verified', decided_by = $2, decided_at = now() where id = $1`, [id, FH.staffId]);
  }
}
// A synthetic patient: an adult with a (synthetic, sealed-format) NIK by default; a newborn with no number.
async function patient(t: T, name = "Pasien Persetujuan", birth = "1990-01-01", newborn = false): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, "");
  return (await h.admin.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, no_identity_reason, religion, occupation, education,
                           marital_status, registered_branch_id, created_by, created_as)
     select $1, 'RM-' || lpad((count(*) + 1)::text, 6, '0'), $2, $4::date, 'female', $5, $6, $7, $8, 'islam', 'Karyawan', 's1', 'kawin', $3,
            (select s.id from staff s where s.tenant_id = $1 limit 1), 'fo_cashier' from patients where tenant_id = $1 returning id`,
    [t.tenantId, name, t.b1, birth, newborn ? "newborn_via_guardian" : "nik",
     newborn ? null : `v1.1.${id}.${id}.${id}`, newborn ? null : (id + id).slice(0, 43), newborn ? "Bayi sintetis" : null],
  )).rows[0].id as string;
}
async function visit(t: T, patientId: string, branch = t.b1): Promise<string> {
  return (await h.admin.query(
    `insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', (select s.id from staff s where s.tenant_id = $1 limit 1)) returning id`,
    [t.tenantId, branch, patientId],
  )).rows[0].id as string;
}
// A draft examination by DOC with a plan of `items` (stage, version, qty, dose?).
async function planned(items: { stage?: number; version: string; qty: number; dose?: number }[], p?: string) {
  const pid = p ?? (await patient(A));
  const v = await visit(A, pid);
  const { examId } = await as(DOC, (db) => openExam(db, key(), v));
  const { planId } = await as(DOC, (db) => createPlan(db, key(), examId, "Program Tindakan", "Kondisi uji"));
  const ids: string[] = [];
  for (const i of items) {
    ids.push((await as(DOC, (db) => addPlanItem(db, key(), examId, planId, { stage: i.stage ?? 1, catalog_version_id: i.version, qty: i.qty,
      ...(i.dose ? { dose_micro: i.dose, dose_unit: "unit" as const } : {}) }))).itemId);
  }
  return { patientId: pid, v, examId, planId, ids };
}
async function consent(who: P, v: string, planId: string, extra: Partial<Parameters<typeof captureConsent>[2]> = {}) {
  const t = await as(who, (db) => consentText(db, v, planId));
  return as(who, (db) => captureConsent(db, key(), { visitId: v, planId, signer: "patient", expectedHash: t.content_hash, signature: png(), ...extra }));
}
const sign = (examId: string) => as(DOC, (db) => signRecord(db, key(), examId, STEP));
const check = (v: string, items: string[], performer: P, supervisor: P | null = null, who: P = DOC) =>
  as(who, (db) => checkTreatmentStart(db, v, items, performer.staffId, supervisor?.staffId ?? null));

let A: T;
let B: T;
let OWN: P; let DOC: P; let DOC2: P; let NUR: P; let TH: P; let FH: P; let RO: P; let BC: P; let FO: P; let PH: P; let DOCB2: P;
let BDOC: P;
let toxin: string; // product (PR-11 "units of a product"), no contraindications
let toxin2: string; // a second version of another product
let filler: string; // service, category filler (floor: nurse assists)
let facial: string; // service, category facial (floor: nurse performs)
let peel: string; // service with contraindications text

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 6 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant();
  B = await tenant();
  OWN = await person(A, "owner"); FH = await person(A, "facility_head", A.b1);
  DOC = await person(A, "doctor", A.b1); DOC2 = await person(A, "doctor", A.b1); NUR = await person(A, "nurse", A.b1); TH = await person(A, "therapist", A.b1);
  RO = await person(A, "records_officer", A.b1); BC = await person(A, "bc", A.b1); FO = await person(A, "fo_cashier", A.b1); PH = await person(A, "pharmacist", A.b1);
  DOCB2 = await person(A, "doctor", A.b2);
  BDOC = await person(B, "doctor", B.b1);
  await credential(A, DOC, "dokter", A.b1);
  await credential(A, DOC2, "dokter", A.b1);
  await credential(A, NUR, "perawat", A.b1);
  const prod = async (c: string, name: string) => (await as(OWN, (db) => publish(db, { kind: "product", code: c }, { name, tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 50_000 }, "Produk"))).versionId;
  toxin = await prod("CS-TOX", "Toksin Botulinum");
  toxin2 = await prod("CS-TOX2", "Toksin Merek Lain");
  const svc = async (c: string, name: string, category: string, f: Record<string, unknown>) => {
    const v = await as(OWN, (db) => publish(db, { kind: "service", code: c }, {
      name, tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 500_000, category, prep_min: 10, treatment_min: 30, buffer_min: 10,
      indications: "Indikasi", consent_template: `Templat persetujuan ${name}.`, delegation: "Dokter", aftercare_text: "Perawatan", ...f,
    } as never, "Layanan baru"));
    if (v.approvalId) await as(FH, (db) => db.query(`select approval_decide($1, true, null)`, [v.approvalId]));
    return v.versionId;
  };
  filler = await svc("CS-FIL", "Filler Asam Hialuronat", "filler", { eligibility: [{ role: "doctor", mode: "performs" }, { role: "nurse", mode: "assists" }] });
  facial = await svc("CS-FAC", "Facial Dasar", "facial", { eligibility: [{ role: "doctor", mode: "performs" }, { role: "nurse", mode: "performs" }, { role: "therapist", mode: "performs" }] });
  peel = await svc("CS-PEL", "Peeling Kimia", "peeling_chemical", { contraindications: "Kehamilan; isotretinoin aktif", eligibility: [{ role: "doctor", mode: "performs" }] });
}, 300_000);
afterAll(async () => {
  await app?.end();
  await owner?.end();
  await h?.close();
});

describe("scenario PR-11: consent mismatch", () => {
  it("consent for 20 units; the plan raised to 25 → treatment cannot start until new consent is recorded", async () => {
    const s = await planned([{ version: toxin, qty: 1, dose: 20_000_000 }]);
    await consent(DOC, s.v, s.planId);
    // Raise to 25 units: replace the item (items change only by removal) while the examination is a draft.
    await as(DOC, (db) => removePlanItem(db, key(), s.examId, s.ids[0]));
    const { itemId } = await as(DOC, (db) => addPlanItem(db, key(), s.examId, s.planId, { stage: 1, catalog_version_id: toxin, qty: 1, dose_micro: 25_000_000, dose_unit: "unit" }));
    await sign(s.examId);
    expect(await check(s.v, [itemId], DOC)).toMatchObject({ ok: false, blockers: ["consent_mismatch"] });
    // The list and the page show the consent as outdated.
    expect((await as(DOC, (db) => consentPage(db, s.v))).plans[0].consent).toBe("outdated");
    expect((await as(NUR, (db) => consentQueue(db, A.b1))).visits.find((x) => x.visit_id === s.v)?.plans[0].consent).toBe("outdated");
    expect(await code(as(DOC, (db) => assertCanStart(db, s.v, [itemId], DOC.staffId)))).toBe("ERR_CONSENT_MISSING");
    // New consent (on the signed examination) → ok; the old one is superseded and kept.
    await consent(NUR, s.v, s.planId);
    expect(await check(s.v, [itemId], DOC)).toMatchObject({ ok: true, blockers: [] });
    const hist = (await as(DOC, (db) => consentPage(db, s.v))).plans[0].history;
    expect(hist.map((x) => [x.version, x.state, x.captured_as])).toEqual([[2, "active", "nurse"], [1, "superseded", "doctor"]]);
  });
});

describe("CLIN-022: an added item or a higher dose needs re-consent", () => {
  it("added item, higher qty, other version, dose where none was consented, unit; equal or lower stays valid", async () => {
    const s = await planned([{ version: toxin, qty: 2, dose: 10_000_000 }, { stage: 2, version: facial, qty: 1 }]);
    await consent(DOC, s.v, s.planId);
    await sign(s.examId);
    const g = (items = s.ids) => check(s.v, items, DOC);
    expect(await g()).toMatchObject({ ok: true });
    // Lower dose on the same group stays valid (replace 10 → 8 units).
    const s2 = await planned([{ version: toxin, qty: 1, dose: 10_000_000 }]);
    await consent(DOC, s2.v, s2.planId);
    await as(DOC, (db) => removePlanItem(db, key(), s2.examId, s2.ids[0]));
    const low = (await as(DOC, (db) => addPlanItem(db, key(), s2.examId, s2.planId, { stage: 1, catalog_version_id: toxin, qty: 1, dose_micro: 8_000_000, dose_unit: "unit" }))).itemId;
    // Added item (a second stage-1 item of the same version raises the group's qty and dose).
    const added = (await as(DOC, (db) => addPlanItem(db, key(), s2.examId, s2.planId, { stage: 2, catalog_version_id: toxin2, qty: 1 }))).itemId;
    await sign(s2.examId);
    expect(await check(s2.v, [low], DOC)).toMatchObject({ blockers: ["consent_mismatch"] }); // the added item is not consented
    await consent(DOC, s2.v, s2.planId);
    expect(await check(s2.v, [low, added], DOC)).toMatchObject({ ok: true });
    // Higher qty, other version, dose without consent, removed requested item: each a mismatch on a fresh plan.
    for (const change of ["qty", "version", "dose", "removed", "unit"] as const) {
      const f = await planned([{ version: toxin, qty: 2 }]);
      await consent(DOC, f.v, f.planId);
      let item = f.ids[0];
      if (change !== "removed") await as(DOC, (db) => removePlanItem(db, key(), f.examId, f.ids[0]));
      if (change === "qty") item = (await as(DOC, (db) => addPlanItem(db, key(), f.examId, f.planId, { stage: 1, catalog_version_id: toxin, qty: 3 }))).itemId;
      if (change === "version") item = (await as(DOC, (db) => addPlanItem(db, key(), f.examId, f.planId, { stage: 1, catalog_version_id: toxin2, qty: 2 }))).itemId;
      if (change === "dose") item = (await as(DOC, (db) => addPlanItem(db, key(), f.examId, f.planId, { stage: 1, catalog_version_id: toxin, qty: 2, dose_micro: 1_000_000, dose_unit: "unit" }))).itemId;
      if (change === "unit") item = (await as(DOC, (db) => addPlanItem(db, key(), f.examId, f.planId, { stage: 1, catalog_version_id: toxin, qty: 2, dose_micro: 1_000_000, dose_unit: "ml" }))).itemId;
      if (change === "removed") {
        await as(DOC, (db) => addPlanItem(db, key(), f.examId, f.planId, { stage: 1, catalog_version_id: toxin, qty: 1 }));
        await as(DOC, (db) => removePlanItem(db, key(), f.examId, f.ids[0]));
      }
      await sign(f.examId);
      expect((await check(f.v, [item], DOC)).blockers, change).toEqual(["consent_mismatch"]);
    }
    // Equal amounts split differently (2 → 1 + 1) stay valid.
    const e = await planned([{ version: toxin, qty: 2 }]);
    await consent(DOC, e.v, e.planId);
    await as(DOC, (db) => removePlanItem(db, key(), e.examId, e.ids[0]));
    const a1 = (await as(DOC, (db) => addPlanItem(db, key(), e.examId, e.planId, { stage: 1, catalog_version_id: toxin, qty: 1 }))).itemId;
    const a2 = (await as(DOC, (db) => addPlanItem(db, key(), e.examId, e.planId, { stage: 1, catalog_version_id: toxin, qty: 1 }))).itemId;
    await sign(e.examId);
    expect(await check(e.v, [a1, a2], DOC)).toMatchObject({ ok: true });
    // No consent at all.
    const z = await planned([{ version: toxin, qty: 1 }]);
    await sign(z.examId);
    expect((await check(z.v, z.ids, DOC)).blockers).toEqual(["consent_missing"]);
  });
});

describe("CLIN-005: a missing credential blocks start; eligibility and supervision", () => {
  it("no credential, an expired one; named eligibility over role; floor; assists; supervised needs a credentialed doctor", async () => {
    const s = await planned([{ version: toxin, qty: 1 }, { stage: 2, version: filler, qty: 1 }, { stage: 3, version: facial, qty: 1 }]);
    await consent(DOC, s.v, s.planId);
    await sign(s.examId);
    const [prod, fil, fac] = s.ids;
    expect(await check(s.v, [prod], DOC)).toMatchObject({ ok: true });
    // Missing: DOC2's credentials verified, a new doctor has none.
    const d3 = await person(A, "doctor", A.b1);
    expect((await check(s.v, [prod], d3)).blockers).toEqual(["credential_missing"]);
    expect(await code(as(DOC, (db) => assertCanStart(db, s.v, [prod], d3.staffId)))).toBe("ERR_CREDENTIAL_INVALID");
    // Expired: a permit past its date.
    const d4 = await person(A, "doctor", A.b1);
    await credential(A, d4, "dokter", A.b1, "2025-01-31", "2020-01-01");
    expect((await check(s.v, [prod], d4)).blockers).toEqual(["credential_expired"]);
    // Only an STR (no permit at this branch) is missing, not expired.
    const d5 = await person(A, "doctor", A.b1);
    const strOnly = (await h.admin.query(
      `insert into staff_credentials (tenant_id, staff_id, kind, number, issuer, profession, valid_from, recorded_by) values ($1, $2, 'str', 'STR-SAJA', 'Konsil Kesehatan', 'dokter', '2024-01-01', $3) returning id`,
      [A.tenantId, d5.staffId, OWN.staffId])).rows[0].id as string;
    await h.admin.query(`update staff_credentials set state = 'verified', decided_by = $2, decided_at = now() where id = $1`, [strOnly, FH.staffId]);
    expect((await check(s.v, [prod], d5)).blockers).toEqual(["credential_missing"]);
    // A valid, unexpired pair whose holder lost the branch role is missing (not expired).
    const d6 = await person(A, "doctor", A.b1);
    await credential(A, d6, "dokter", A.b1);
    await h.admin.query(`delete from staff_branches where staff_id = $1`, [d6.staffId]);
    expect((await check(s.v, [prod], d6)).blockers).toEqual(["credential_missing", "not_eligible"]);
    // A product: nurse supervised (needs a credentialed doctor of the branch, not themselves), therapist never.
    expect((await check(s.v, [prod], NUR)).blockers).toEqual(["not_eligible"]);
    expect(await check(s.v, [prod], NUR, DOC)).toMatchObject({ ok: true });
    expect((await check(s.v, [prod], NUR, NUR)).blockers).toEqual(["not_eligible"]);
    expect((await check(s.v, [prod], NUR, d3)).blockers).toEqual(["not_eligible"]); // supervisor without credentials
    await credential(A, DOCB2, "dokter", A.b2);
    await credential(A, DOCB2, "dokter", A.b1); // a permit for b1 too, but no doctor role at b1
    expect((await check(s.v, [prod], NUR, DOCB2)).blockers).toEqual(["not_eligible"]); // supervisor of another branch
    // A credentialed nurse is not a supervisor (a doctor of the branch is).
    const n2 = await person(A, "nurse", A.b1);
    await credential(A, n2, "perawat", A.b1);
    expect((await check(s.v, [prod], n2, NUR)).blockers).toEqual(["not_eligible"]);
    expect(await check(s.v, [prod], n2, DOC2)).toMatchObject({ ok: true });
    expect((await check(s.v, [prod], TH)).blockers).toEqual(["credential_missing", "not_eligible"]);
    expect((await check(s.v, [prod], TH, DOC)).blockers).toEqual(["credential_missing", "not_eligible"]);
    // A filler service: nurse assists (floor and row) → not eligible; doctor performs.
    expect((await check(s.v, [fil], NUR, DOC)).blockers).toEqual(["not_eligible"]);
    expect(await check(s.v, [fil], DOC)).toMatchObject({ ok: true });
    // A facial service: the nurse performs by row and floor.
    expect(await check(s.v, [fac], NUR)).toMatchObject({ ok: true });
    // The floor caps a row: a named row "performs" for the nurse on a filler is still capped to assists.
    await h.admin.query(`insert into service_staff_eligibility (tenant_id, version_id, staff_id, mode) values ($1, $2, $3, 'performs')`, [A.tenantId, filler, NUR.staffId]);
    expect((await check(s.v, [fil], NUR, DOC)).blockers).toEqual(["not_eligible"]);
    // The floor caps a role row too: a nurse role row "performs" on a filler (floor: assists) stays not eligible.
    await h.admin.query(`insert into service_staff_eligibility (tenant_id, version_id, role, mode) values ($1, $2, 'therapist', 'performs')`, [A.tenantId, filler]);
    const th2 = await person(A, "therapist", A.b1);
    await credential(A, th2, "perawat", A.b1);
    expect((await check(s.v, [fil], th2, DOC)).blockers).toEqual(["not_eligible"]); // therapist floor for filler: none
    // A named row overrides the role row: a nurse named "assists" on the facial is not eligible.
    await h.admin.query(`insert into service_staff_eligibility (tenant_id, version_id, staff_id, mode) values ($1, $2, $3, 'assists')`, [A.tenantId, facial, NUR.staffId]);
    expect((await check(s.v, [fac], NUR)).blockers).toEqual(["not_eligible"]);
    // A doctor demoted to "supervised" on a service by a named row needs another doctor: never themselves (review P2-1).
    await h.admin.query(`insert into service_staff_eligibility (tenant_id, version_id, staff_id, mode) values ($1, $2, $3, 'supervised')`, [A.tenantId, filler, DOC2.staffId]);
    expect((await check(s.v, [fil], DOC2)).blockers).toEqual(["not_eligible"]);
    expect((await check(s.v, [fil], DOC2, DOC2)).blockers).toEqual(["not_eligible"]);
    expect(await check(s.v, [fil], DOC2, DOC)).toMatchObject({ ok: true });
    // A clinician holding nurse and therapist: the service's therapist row counts (review P2-2; as booking_eligible).
    const nt = await person(A, ["nurse", "therapist"], A.b1);
    await credential(A, nt, "perawat", A.b1);
    const body = await as(OWN, (db) => publish(db, { kind: "service", code: "CS-BOD" }, {
      name: "Perawatan Tubuh", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 300_000, category: "body_treatment", prep_min: 10, treatment_min: 30,
      buffer_min: 10, indications: "Indikasi", consent_template: "Templat tubuh.", delegation: "Terapis", aftercare_text: "Perawatan", eligibility: [{ role: "therapist", mode: "performs" }],
    } as never, "Layanan baru"));
    if (body.approvalId) await as(FH, (db) => db.query(`select approval_decide($1, true, null)`, [body.approvalId]));
    const b2 = await planned([{ version: body.versionId, qty: 1 }]);
    await consent(DOC, b2.v, b2.planId);
    await sign(b2.examId);
    expect(await check(b2.v, b2.ids, nt)).toMatchObject({ ok: true });
    expect((await check(b2.v, b2.ids, NUR)).blockers).toEqual(["not_eligible"]); // a nurse only: no nurse row
    // A product for a nurse + therapist: the nurse's "supervised" is the best of the two.
    expect((await check(s.v, [prod], nt)).blockers).toEqual(["not_eligible"]);
    expect(await check(s.v, [prod], nt, DOC)).toMatchObject({ ok: true });
    // An unsigned examination blocks; every blocker is reported at once.
    const u = await planned([{ version: toxin, qty: 1 }]);
    expect((await check(u.v, u.ids, d3)).blockers).toEqual(["examination_unsigned", "credential_missing", "consent_missing"]);
  });
});

describe("contraindications", () => {
  it("an item with contraindications needs the examining doctor's clearing; a block blocks; only that doctor reviews", async () => {
    const s = await planned([{ version: peel, qty: 1 }, { stage: 2, version: toxin, qty: 1 }]);
    await consent(DOC, s.v, s.planId);
    const [pl, tx] = s.ids;
    for (const who of [DOC2, NUR, FH]) expect(await code(as(who, (db) => reviewContraindication(db, key(), s.examId, pl, "cleared"))), who.role).toBe("ERR_FORBIDDEN");
    const dn = await person(A, ["doctor", "nurse"], A.b1);
    const v2 = await visit(A, await patient(A));
    const { examId: ex2 } = await as(dn, (db) => openExam(db, key(), v2));
    const { planId: pl2 } = await as(dn, (db) => createPlan(db, key(), ex2, "Program", "Kondisi"));
    const { itemId: it2 } = await as(dn, (db) => addPlanItem(db, key(), ex2, pl2, { stage: 1, catalog_version_id: peel, qty: 1 }));
    expect(await code(as(dn, (db) => reviewContraindication(db, key(), ex2, it2, "cleared"), "nurse"))).toBe("ERR_FORBIDDEN");
    expect(await as(dn, (db) => reviewContraindication(db, key(), ex2, it2, "cleared"), "doctor")).toMatchObject({ version: 1 });

    expect(await code(as(DOC, (db) => reviewContraindication(db, key(), s.examId, pl, "blocked")))).toBe("ERR_INVALID_INPUT");
    await sign(s.examId);
    expect((await check(s.v, [pl], DOC)).blockers).toEqual(["contraindication_unresolved"]);
    expect(await check(s.v, [tx], DOC)).toMatchObject({ ok: true }); // no contraindication text: nothing to clear
    expect(await as(DOC, (db) => reviewContraindication(db, key(), s.examId, pl, "cleared"))).toMatchObject({ version: 1 });
    expect(await check(s.v, [pl], DOC)).toMatchObject({ ok: true });
    expect(await as(DOC, (db) => reviewContraindication(db, key(), s.examId, tx, "blocked", "Alergi bahan"))).toMatchObject({ version: 1 });
    expect((await check(s.v, [tx], DOC)).blockers).toEqual(["contraindication_unresolved"]);
    expect(await as(DOC, (db) => reviewContraindication(db, key(), s.examId, tx, "cleared", "Sudah dipastikan aman"))).toMatchObject({ version: 2 });
    expect(await as(DOC, (db) => reviewContraindication(db, key(), s.examId, tx, "cleared", "Sudah dipastikan aman"))).toMatchObject({ version: 2 });
    expect(await check(s.v, [pl, tx], DOC)).toMatchObject({ ok: true });
  });
});

describe("capture: text, hash, signer, guardian, signature, withdrawal", () => {
  it("the text holds the items and templates; a stale hash is refused; a guardian for a minor and a newborn", async () => {
    const s = await planned([{ version: toxin, qty: 1, dose: 2_500_000 }, { stage: 2, version: peel, qty: 1 }]);
    const t = await as(NUR, (db) => consentText(db, s.v, s.planId));
    expect(t.text).toContain("Toksin Botulinum × 1 (dosis 2,5 unit)");
    expect(t.text).toContain("Templat persetujuan Peeling Kimia.");
    expect(t.text).toContain("Kontraindikasi: Kehamilan; isotretinoin aktif");
    expect(t.text).toContain("Saya telah mendapat penjelasan"); // the fallback clause for a product without a template
    expect(t.content_hash).toBe(createHash("sha256").update(t.text, "utf8").digest("hex"));
    // The plan changes after the text was shown: refused.
    await as(DOC, (db) => addPlanItem(db, key(), s.examId, s.planId, { stage: 3, catalog_version_id: toxin2, qty: 1 }));
    expect(await reason(as(DOC, (db) => captureConsent(db, key(), { visitId: s.v, planId: s.planId, signer: "patient", expectedHash: t.content_hash, signature: png() })))).toBe("plan_changed");
    // Signature: a PNG ≥ 320 × 160, ≤ 200 KB.
    for (const bad of [png(300, 200), png(640, 100), Buffer.from("bukan gambar"), png(640, 240, 210_000)]) {
      expect(await reason(consent(DOC, s.v, s.planId, { signature: bad }))).toBe("signature");
    }
    // A minor (16) and a newborn need a guardian.
    const minorBirth = new Date(Date.now() - 16 * 365.25 * 86_400_000).toISOString().slice(0, 10);
    const m = await planned([{ version: toxin, qty: 1 }], await patient(A, "Pasien Remaja", minorBirth));
    expect(await reason(consent(DOC, m.v, m.planId))).toBe("guardian_required");
    expect(await code(consent(DOC, m.v, m.planId, { signer: "guardian" }))).toBe("ERR_INVALID_INPUT");
    const g = await consent(DOC, m.v, m.planId, { signer: "guardian", guardianName: "Ibu Pasien", guardianRelation: "ibu" });
    expect((await h.admin.query(`select signer, guardian_name, guardian_relation from procedure_consents where id = $1`, [g.consentId])).rows[0])
      .toEqual({ signer: "guardian", guardian_name: "Ibu Pasien", guardian_relation: "ibu" });
    // A newborn (no identity number) needs a guardian whatever the birth date says.
    const nb = await planned([{ version: toxin, qty: 1 }], await patient(A, "Bayi Baru", "1990-01-01", true));
    expect(await reason(consent(DOC, nb.v, nb.planId))).toBe("guardian_required");
    // An adult signs alone.
    const ad = await planned([{ version: toxin, qty: 1 }]);
    expect((await consent(DOC, ad.v, ad.planId)).consentId).toMatch(/^[0-9a-f-]{36}$/);
    // A removed item is neither in the text nor among the consented items.
    const rm = await planned([{ version: toxin, qty: 1 }, { stage: 2, version: toxin2, qty: 1 }]);
    await as(DOC, (db) => removePlanItem(db, key(), rm.examId, rm.ids[1]));
    expect((await as(DOC, (db) => consentText(db, rm.v, rm.planId))).text).not.toContain("Toksin Merek Lain");
    const rc = await consent(DOC, rm.v, rm.planId);
    expect((await h.admin.query(`select plan_item_id from procedure_consent_items where consent_id = $1`, [rc.consentId])).rows.map((x) => x.plan_item_id)).toEqual([rm.ids[0]]);
    // An empty plan cannot be consented.
    const e = await planned([{ version: toxin, qty: 1 }]);
    await as(DOC, (db) => removePlanItem(db, key(), e.examId, e.ids[0]));
    expect(await reason(consent(DOC, e.v, e.planId))).toBe("empty_plan");
  });

  it("withdrawal ends the consent, resets the visit step, and is allowed in exit; capture by doctor or nurse only", async () => {
    const s = await planned([{ version: toxin, qty: 1 }]);
    const { consentId } = await consent(DOC, s.v, s.planId);
    expect((await h.admin.query(`select consent from visits where id = $1`, [s.v])).rows[0].consent).toBe("done");
    for (const who of [BC, FO, PH, TH, FH, RO, OWN]) expect(await code(consent(who, s.v, s.planId)), who.role).toBe("ERR_FORBIDDEN");
    const hash = (await as(DOC, (db) => consentText(db, s.v, s.planId))).content_hash;
    expect(await code(as(DOCB2, (db) => captureConsent(db, key(), { visitId: s.v, planId: s.planId, signer: "patient", expectedHash: hash, signature: png() })))).toBe("ERR_NOT_FOUND");
    // The database checks the signature bytes itself (a non-PNG straight to the writer).
    expect(await code(as(DOC, (db) => db.query(`select procedure_consent_capture($1, $2, $3::jsonb, $4)`,
      [s.v, s.planId, JSON.stringify({ signer: "patient", expected_hash: hash }), Buffer.alloc(100, 7)])))).toBe("raw:22023");
    expect(await code(as(DOC, (db) => withdrawConsent(db, key(), consentId, "ab")))).toBe("ERR_INVALID_INPUT");
    await as(NUR, (db) => withdrawConsent(db, key(), consentId, "Pasien berubah pikiran"));
    expect((await h.admin.query(`select state, withdrawn_as from procedure_consents where id = $1`, [consentId])).rows[0]).toEqual({ state: "withdrawn", withdrawn_as: "nurse" });
    expect((await h.admin.query(`select consent from visits where id = $1`, [s.v])).rows[0].consent).toBe("not_started");
    expect(await code(as(DOC, (db) => withdrawConsent(db, key(), consentId, "Lagi")))).toBe("ERR_VERSION_CONFLICT");
    await sign(s.examId);
    expect((await check(s.v, s.ids, DOC)).blockers).toEqual(["consent_missing"]);
    // A tenant in exit cannot capture but can withdraw.
    const k2 = await consent(DOC, s.v, s.planId);
    await h.admin.query(`update tenants_registry set lifecycle_state = 'exit' where id = $1`, [A.tenantId]);
    try {
      expect(await code(consent(DOC, s.v, s.planId))).toBe("ERR_TENANT_SUSPENDED");
      await as(DOC, (db) => withdrawConsent(db, key(), k2.consentId, "Tarik sebelum tutup"));
    } finally {
      await h.admin.query(`update tenants_registry set lifecycle_state = 'live' where id = $1`, [A.tenantId]);
    }
  });
});

describe("readers, guards, signature, events, cross-tenant", () => {
  it("clinical readers read; BC, FO, pharmacist never; the signature is hidden from grants and served audited", async () => {
    const s = await planned([{ version: toxin, qty: 1 }], await patient(A, "Pasien Rahasia Persetujuan"));
    const sig = png(640, 240, 9);
    const t = await as(DOC, (db) => consentText(db, s.v, s.planId));
    const { consentId } = await as(DOC, (db) => captureConsent(db, key(), { visitId: s.v, planId: s.planId, signer: "patient", expectedHash: t.content_hash, signature: sig }));
    const rows = (who: P) => as(who, async (db) => (await db.query(`select count(*)::int as n from procedure_consents where id = $1`, [consentId])).rows[0].n as number);
    for (const who of [DOC, NUR, TH, FH, RO]) expect(await rows(who), who.role).toBe(1);
    for (const who of [BC, FO, PH, OWN, DOCB2]) expect(await rows(who), who.role).toBe(0);
    for (const r of ["clinic_app", "clinic_operator"]) {
      expect((await h.admin.query(`select has_column_privilege($1, 'public.procedure_consents', 'signature_png', 'select') as ok`, [r])).rows[0].ok, r).toBe(false);
    }
    expect((await as(DOC, (db) => consentSignature(db, consentId))).equals(sig)).toBe(true);
    for (const who of [BC, FO, PH]) expect(await code(as(who, (db) => consentSignature(db, consentId))), who.role).toBe("ERR_NOT_FOUND");
    const idem = (await h.admin.query(`select result::text as r from idempotency_records where command = 'procedure_consent_capture' order by created_at desc limit 1`)).rows[0].r as string;
    expect(idem.length).toBeLessThan(80);
    // List and page for doctor and nurse; others refused.
    const q = await as(NUR, (db) => consentQueue(db, A.b1));
    expect(q.visits.find((x) => x.visit_id === s.v)?.plans[0].consent).toBe("active");
    for (const who of [BC, FO, FH]) expect(await code(as(who, (db) => consentQueue(db, A.b1))), who.role).toBe("ERR_FORBIDDEN");
    expect(await code(as(FO, (db) => consentPage(db, s.v)))).toBe("ERR_NOT_FOUND");
    for (const who of [BC, FO, PH]) expect(await code(check(s.v, s.ids, DOC, null, who)), who.role).toBe("ERR_FORBIDDEN");
    // Audit and events.
    const au = (await h.admin.query(`select action, reason_code, reason from audit_events where object_id = $1 order by seq`, [consentId])).rows;
    expect(au.map((r) => [r.action, r.reason_code])).toEqual([["sign", "consent_recorded"], ["media_view", "consent_signature_viewed"]]);
    expect(au.every((r) => r.reason === null)).toBe(true);
    const ev = (await h.admin.query(`select type, payload from domain_events where aggregate_id = $1`, [consentId])).rows;
    expect(ev.map((e) => e.type)).toEqual(["ConsentRecorded"]);
    expect(JSON.stringify(ev)).not.toMatch(/rahasia|toksin/i);
  });

  it("guards: nothing deleted, a consent frozen except one supersession or withdrawal, items insert-only; triggers always", async () => {
    const s = await planned([{ version: toxin, qty: 1 }, { stage: 2, version: peel, qty: 1 }]);
    const { consentId } = await consent(DOC, s.v, s.planId);
    await as(DOC, (db) => reviewContraindication(db, key(), s.examId, s.ids[1], "cleared"));
    await expect(h.admin.query(`delete from procedure_consents where id = $1`, [consentId])).rejects.toThrow(/never deleted/);
    await expect(h.admin.query(`update procedure_consents set consent_text = consent_text || ' ' where id = $1`, [consentId])).rejects.toThrow(/final/);
    await expect(h.admin.query(`update procedure_consents set signer = 'guardian', guardian_name = 'Siapa', guardian_relation = 'wali' where id = $1`, [consentId])).rejects.toThrow(/final/);
    await expect(h.admin.query(`update procedure_consent_items set qty = 9 where consent_id = $1`, [consentId])).rejects.toThrow(/never change/);
    await expect(h.admin.query(`delete from procedure_consent_items where consent_id = $1`, [consentId])).rejects.toThrow(/never deleted/);
    await expect(h.admin.query(`delete from contraindication_reviews where examination_id = $1`, [s.examId])).rejects.toThrow(/never deleted/);
    await expect(h.admin.query(`update contraindication_reviews set plan_item_id = $2 where examination_id = $1`, [s.examId, s.ids[0]])).rejects.toThrow(/keeps its examination/);
    await as(DOC, (db) => withdrawConsent(db, key(), consentId, "Tarik uji"));
    await expect(h.admin.query(`update procedure_consents set state = 'superseded', superseded_at = now(), superseded_by_id = id where id = $1`, [consentId])).rejects.toThrow(/final/);
    await h.admin.query(`update visits set closed_at = now(), closed_by = checked_in_by where id = $1`, [s.v]);
    await expect(h.admin.query(`update contraindication_reviews set decision = 'blocked', reason = 'Terlambat' where examination_id = $1`, [s.examId])).rejects.toThrow(/closed visit is final/);
    expect(await code(consent(DOC, s.v, s.planId))).toBe("ERR_VERSION_CONFLICT");
    for (const t of TABLES) await expect(h.admin.query(`truncate ${t} cascade`)).rejects.toThrow();
    const trig = (await h.admin.query(`select tgname, tgenabled from pg_trigger where tgrelid = any($1::regclass[]) and not tgisinternal order by 1`, [TABLES])).rows;
    expect(trig.map((r) => `${r.tgname}:${r.tgenabled}`)).toEqual([
      "contraindication_reviews_guard:A", "contraindication_reviews_no_truncate:A", "procedure_consent_items_guard:A", "procedure_consent_items_no_truncate:A",
      "procedure_consents_guard:A", "procedure_consents_no_truncate:A"]);
  });

  it("support classes; helpers not executable; cross-tenant reads and writes nothing", async () => {
    const kinds = (await h.admin.query(`select support_class from support_object_kinds where table_name = any($1::text[])`, [TABLES.map((t) => `public.${t}`)])).rows;
    expect(kinds.map((k) => k.support_class)).toEqual(["clinical", "clinical", "clinical"]);
    for (const f of ["consent_guard()", "consent_staff_role(uuid,uuid,uuid,text)", "consent_dose(bigint)", "consent_text_of(uuid,uuid)", "consent_actor(boolean)",
      "consent_mode(uuid,uuid,uuid,uuid)", "consent_credential_lapsed(uuid,uuid,uuid)", "consent_state(uuid,uuid)"]) {
      for (const r of ["clinic_app", "clinic_vendor", "clinic_operator"]) {
        expect((await h.admin.query(`select has_function_privilege($1, $2, 'execute') as ok`, [r, `public.${f}`])).rows[0].ok, `${r} ${f}`).toBe(false);
      }
    }
    const s = await planned([{ version: toxin, qty: 1 }]);
    const { consentId } = await consent(DOC, s.v, s.planId);
    for (const t of TABLES) expect(await as(BDOC, async (db) => (await db.query(`select count(*)::int as n from ${t}`)).rows[0].n)).toBe(0);
    expect(await code(as(BDOC, (db) => consentText(db, s.v, s.planId)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BDOC, (db) => captureConsent(db, key(), { visitId: s.v, planId: s.planId, signer: "patient", expectedHash: "0".repeat(64), signature: png() })))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BDOC, (db) => withdrawConsent(db, key(), consentId, "Coba tarik")))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BDOC, (db) => checkTreatmentStart(db, s.v, s.ids, BDOC.staffId)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BDOC, (db) => consentPage(db, s.v)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BDOC, (db) => consentSignature(db, consentId)))).toBe("ERR_NOT_FOUND");
  });
});
