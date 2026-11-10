// T-059 M2 exit flow (PLAN §1 M2; plan review r1 P2-2): one patient through every M2 module on a real database,
// through the real writers only — no trigger disabled, no row inserted around a writer, except the documented
// stand-ins of earlier tasks: the visit row (its writer is the M1 check-in; patients and visits are seeded as the
// M2 tests do), and the step-up proof `{ verified: true }` that the clinical signing UI will produce (T-053).
// A credentialed doctor; the BC's intake with an allergy (a caution for the clinicians); the doctor verifies the
// fact, writes the sheet, a face-map mark with a dose, two parallel plans, the BC/FO projection, clears a
// contraindication; a clinical photo behind a short-lived link; signing; procedure consent and the start gate; a
// nurse's addition approved (the consent no longer covers the plan, FO alerted), re-consent, the gate passes again;
// a visit-note complaint taken and resolved (FO sees the status only); a signed letter from a template and its
// correction; a record correction within 48 h and the patient copy. Events, audit and notifications are
// content-free. Synthetic data (MIG-2).
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../../src/db/rls/context";
import { openAppPool } from "../../../src/db/rls/pool";
import { decideApproval } from "../../../src/modules/approvals/approvals";
import { publish } from "../../../src/modules/catalog/catalog";
import { flagComplaint, getComplaint, resolveComplaint, takeComplaint } from "../../../src/modules/clinical/complaints/complaints";
import { captureConsent, checkTreatmentStart, consentText, reviewContraindication } from "../../../src/modules/clinical/consent/consent";
import { addPlanItem, createPlan, examSheet, openExam, saveExam, setMark, verifyFact } from "../../../src/modules/clinical/exam/exam";
import { openIntake, patientCautions, saveIntake, sendIntake } from "../../../src/modules/clinical/intake/intake";
import { addMedia, issueToken, redeemToken } from "../../../src/modules/clinical/media/media";
import { correctRecord, getRecord, requestRecordCopy, signRecord, type StepUp } from "../../../src/modules/clinical/records/records";
import { createRequest, decideRequest } from "../../../src/modules/clinical/requests/requests";
import { correctLetter, createLetter, getLetter, saveTemplate, signLetter } from "../../../src/modules/documents/documents";
import { list as listNotifications } from "../../../src/modules/notifications/notifications";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { credentialValid, decideCredential, recordCredential } from "../../../src/modules/org/licences/licences";
import { createHarness, type Harness } from "../../../tests/rls/harness";

process.env.DEPLOY_ENV = "local"; // synthetic data (MIG-2)

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let n = 0;
type P = { acc: string; staffId: string; role: Role; branch?: string };
let tenantId: string;
let branch: string;
const STEP: StepUp = { verified: true }; // the step-up proof the clinical signing UI will produce (T-053)
const TENANT_WIDE = ["owner", "admin_pusat"];

async function person(role: Role, name: string): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ($1, $2, true) returning id`, [name, `m2flow${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId, accountId: acc, displayName: name });
  const rid = await assignRole(h.admin, { tenantId, staffId, role });
  if (!TENANT_WIDE.includes(role)) await assignBranch(h.admin, { tenantId, staffRoleId: rid, branchId: branch });
  return { acc, staffId, role, branch: TENANT_WIDE.includes(role) ? undefined : branch };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
const key = () => crypto.randomUUID();
function png(w: number, hgt: number, salt = 0): Buffer {
  const b = Buffer.alloc(80 + salt);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(hgt, 20);
  return b;
}

let OWN: P; let AP: P; let FH: P; let DOC: P; let NUR: P; let BC: P; let FO: P; let RO: P;
let toxin: string; let filler: string; let peel: string;

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 4 });
  app.on("error", () => {});
  owner = new pg.Pool({ connectionString: h.ownerUrl(), max: 2 });
  owner.on("error", () => {});
  tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Klinik Alur M2 Sintetis', 'emkm')`, [tenantId]);
  branch = (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, 'M2', 'Cabang Alur', 'Asia/Jakarta') returning id`, [tenantId])).rows[0].id as string;
  OWN = await person("owner", "Ibu Pemilik"); AP = await person("admin_pusat", "Admin Pusat"); FH = await person("facility_head", "dr. Kepala");
  DOC = await person("doctor", "dr. Ayu"); NUR = await person("nurse", "Rani Perawat"); BC = await person("bc", "Sinta BC");
  FO = await person("fo_cashier", "Dina FO"); RO = await person("records_officer", "Rudi Rekam Medis");
  const prod = async (c: string, name: string, price: number) => (await as(OWN, (db) => publish(db, { kind: "product", code: c }, { name, tax_category: "taxable_goods", tax_basis: "Barang", normal_price: price }, "Produk"))).versionId;
  toxin = await prod("M2-TOX", "Toksin Botulinum", 50_000);
  filler = await prod("M2-FIL", "Filler Asam Hialuronat", 300_000);
  // A service with contraindications, clinically approved (T-034): the start gate needs the examining doctor's clearing.
  const svc = await as(OWN, (db) => publish(db, { kind: "service", code: "M2-PEL" }, {
    name: "Peeling Kimia", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 500_000, category: "peeling_chemical", prep_min: 10, treatment_min: 30, buffer_min: 10,
    indications: "Indikasi", contraindications: "Kehamilan; isotretinoin aktif", consent_template: "Saya memahami tindakan peeling kimia.", delegation: "Dokter",
    aftercare_text: "Hindari matahari", eligibility: [{ role: "doctor", mode: "performs" }],
  } as never, "Layanan baru"));
  if (svc.approvalId) await as(FH, (db) => decideApproval(db, svc.approvalId!, true));
  peel = svc.versionId;
}, 300_000);
afterAll(async () => {
  await app?.end();
  await owner?.end();
  await h?.close();
});

describe("M2 exit flow", () => {
  it("one patient through every M2 module on a real database, through the real writers", async () => {
    // ── T-050: the doctor's STR and branch SIP, recorded by the owner and verified by the facility head.
    for (const c of [{ kind: "str" as const, number: "STR-M2-1", issuer: "Konsil Kesehatan Indonesia", profession: "dokter" as const, validFrom: "2024-01-01" },
      { kind: "sip" as const, number: "SIP-M2-1", issuer: "Dinas Kesehatan Kota", profession: "dokter" as const, branchId: branch, validFrom: "2024-01-01", expiresOn: "2099-12-31" }]) {
      const { credentialId } = await as(OWN, (db) => recordCredential(db, key(), DOC.staffId, c));
      await as(FH, (db) => decideCredential(db, key(), credentialId, true));
    }
    expect(await as(DOC, (db) => credentialValid(db, DOC.staffId, branch))).toBe(true);

    // Patient and visit (the M1 check-in writer's row; seeded as the M2 tests do).
    const id = crypto.randomUUID().replace(/-/g, "");
    const patient = (await h.admin.query(
      `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation, education, marital_status,
                             registered_branch_id, created_by, created_as)
       values ($1, 'RM-000001', 'Pasien Rahasia Alur', '1990-01-01', 'female', 'nik', $3, $4, 'islam', 'Karyawan', 's1', 'kawin', $2, $5, 'fo_cashier') returning id`,
      [tenantId, branch, `v1.1.${id}.${id}.${id}`, (id + id).slice(0, 43), FO.staffId])).rows[0].id as string;
    const visit = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`,
      [tenantId, branch, patient, FO.staffId])).rows[0].id as string;

    // ── T-051: the BC's intake with an allergy; sent, it is a caution for the clinicians (unverified, BC-captured).
    const { intakeId } = await as(BC, (db) => openIntake(db, key(), visit));
    expect(await as(BC, (db) => saveIntake(db, key(), intakeId, { complaint: "Jerawat di dagu", facts: [{ kind: "allergy", value: "Amoksisilin" }],
      observation: { chips: ["kering"], note: "Area pipi" } }))).toMatchObject({ ok: true });
    await as(BC, (db) => sendIntake(db, key(), intakeId));
    expect((await as(DOC, (db) => patientCautions(db, patient))).map((c) => [c.kind, c.provenance])).toEqual([["allergy", "bc_captured_unverified"]]);

    // ── T-052: the doctor's sheet: the BC fact verified (its author kept), SOAP, a mark with a dose, two parallel plans.
    const { examId } = await as(DOC, (db) => openExam(db, key(), visit));
    const fact = (await h.admin.query(`select id from intake_facts where intake_id = $1 and kind = 'allergy'`, [intakeId])).rows[0].id as string;
    await as(DOC, (db) => verifyFact(db, key(), examId, fact, "confirmed"));
    await as(DOC, (db) => saveExam(db, key(), examId, { subjective: "Jerawat di dagu", assessment: "Akne vulgaris ringan", icd10_codes: ["L70.0"], vitals: { nadi: 80 } }));
    await as(DOC, (db) => setMark(db, key(), examId, { template: "face_front", layer: "tindakan", x: 500, y: 600, label: "Glabela", catalog_version_id: toxin, dose_micro: 20_000_000, dose_unit: "unit" }));
    const { planId } = await as(DOC, (db) => createPlan(db, key(), examId, "Program Kulit", "Akne dan kerutan"));
    const { planId: plan2 } = await as(DOC, (db) => createPlan(db, key(), examId, "Program Pigmen", "Flek"));
    const { itemId: tox } = await as(DOC, (db) => addPlanItem(db, key(), examId, planId, { stage: 1, catalog_version_id: toxin, qty: 1, dose_micro: 20_000_000, dose_unit: "unit" }));
    const { itemId: pel } = await as(DOC, (db) => addPlanItem(db, key(), examId, plan2, { stage: 1, catalog_version_id: peel, qty: 1 }));
    const sheet = await as(DOC, (db) => examSheet(db, visit));
    expect(sheet.plans.map((p) => p.id).sort()).toEqual([planId, plan2].sort());
    // The BC and FO see items and prices only (plan_options), never the condition or a dose.
    const proj = JSON.stringify(await as(FO, async (db) => (await db.query(`select plan_options($1) as r`, [visit])).rows[0].r));
    expect(proj).toContain("Toksin Botulinum");
    expect(proj).not.toMatch(/Akne|kerutan|dose_micro|20000000/);
    // ── T-054: the examining doctor clears the service's contraindication.
    await as(DOC, (db) => reviewContraindication(db, key(), examId, pel, "cleared"));

    // ── T-055: a clinical photo behind a short-lived link of the issuer.
    const bytes = png(1200, 1600);
    const { mediaId } = await as(DOC, (db) => addMedia(db, key(), { visitId: visit, kind: "photo", angle: "depan", fileName: "wajah.png", bytes, examinationId: examId }));
    const t = await as(DOC, (db) => issueToken(db, key(), mediaId, "view"));
    expect((await as(DOC, (db) => redeemToken(db, t.token))).bytes.equals(bytes)).toBe(true);

    // ── T-053: signing with the step-up proof: version 1, the sheet final.
    await as(DOC, (db) => signRecord(db, key(), examId, STEP));
    expect((await as(RO, (db) => getRecord(db, examId))).versions.map((v) => v.version)).toEqual([1]);

    // ── T-054: consent for each plan, then the start gate passes for the credentialed doctor.
    const sign = async (who: P, plan: string) => {
      const tx = await as(who, (db) => consentText(db, visit, plan));
      await as(who, (db) => captureConsent(db, key(), { visitId: visit, planId: plan, signer: "patient", expectedHash: tx.content_hash, signature: png(640, 240, ++n) }));
    };
    await sign(DOC, planId);
    await sign(DOC, plan2);
    // The gate checks the items of one plan per start.
    for (const items of [[tox], [pel]]) expect((await as(DOC, (db) => checkTreatmentStart(db, visit, items, DOC.staffId))).blockers, items[0]).toEqual([]);

    // ── T-056: the nurse proposes an additional filler; the doctor approves: the plan grows, the consent no longer
    // covers it, the visit's consent step reopens, the gate blocks and FO is alerted; re-consent opens the gate.
    const { requestId } = await as(NUR, (db) => createRequest(db, key(), visit, { kind: "addition", planId, catalogVersionId: filler, stage: 1, qty: 1,
      doseMicro: 1_000_000, doseUnit: "ml", reason: "Lipatan nasolabial" }));
    const d = await as(DOC, (db) => decideRequest(db, key(), requestId, true, null));
    expect([d.state, (d as { consent: string }).consent]).toEqual(["approved", "outdated"]);
    expect((await h.admin.query(`select consent from visits where id = $1`, [visit])).rows[0].consent).toBe("in_progress");
    const added = (d as { item_id: string }).item_id;
    expect((await as(DOC, (db) => checkTreatmentStart(db, visit, [tox, added], DOC.staffId))).blockers).toContain("consent_mismatch");
    expect((await as(FO, (db) => listNotifications(db, { open: true }))).some((x) => x.type === "clinical_request_approved" && x.subjectId === requestId)).toBe(true);
    await sign(NUR, planId);
    expect((await h.admin.query(`select consent from visits where id = $1`, [visit])).rows[0].consent).toBe("done");
    expect((await as(DOC, (db) => checkTreatmentStart(db, visit, [tox, added], DOC.staffId))).blockers).toEqual([]);

    // ── T-057: a visit-note complaint by FO, taken and resolved with a free control; FO sees the status only.
    const { taskId } = await as(FO, (db) => flagComplaint(db, key(), { patientId: patient, visitId: visit, kind: "klinis", source: "visit_note", triage: "merah",
      summary: "Bengkak rahasia setelah filler" }));
    await as(DOC, (db) => takeComplaint(db, key(), taskId));
    await as(DOC, (db) => resolveComplaint(db, key(), taskId, "kontrol_gratis", "Kontrol gratis besok"));
    const foView = await as(FO, (db) => getComplaint(db, taskId));
    expect([foView.state, foView.content]).toEqual(["resolved", false]);
    // The patient's name is FO's to see; the clinical summary and the resolution are not.
    expect(JSON.stringify(foView)).not.toMatch(/Bengkak|Kontrol gratis besok|summary|resolution_note/);

    // ── T-058: a letter template; a surat keterangan from it, signed, then corrected as version 2.
    const tpl = await as(AP, (db) => saveTemplate(db, key(), null, { kind: "letter", letterType: "surat_keterangan", name: "Surat Keterangan Istirahat",
      body: "{{klinik.nama}}\nSURAT KETERANGAN {{tanggal}}\n{{pasien.nama}} ({{pasien.no_rm}}) perlu istirahat.\n{{dokter.nama}} SIP {{dokter.sip}}", paper: "a4" }));
    const { letterId } = await as(DOC, (db) => createLetter(db, key(), visit, tpl.versionId));
    await as(DOC, (db) => signLetter(db, key(), letterId, STEP));
    const letter = await as(DOC, (db) => getLetter(db, letterId));
    expect(letter.body).toContain("SIP SIP-M2-1");
    await as(DOC, (db) => correctLetter(db, key(), letterId, letter.body.replace("perlu istirahat", "perlu istirahat dua hari"), "Lama istirahat"));
    expect((await as(RO, (db) => getLetter(db, letterId))).versions.map((v) => [v.version, v.kind])).toEqual([[2, "correction"], [1, "original"]]);

    // ── T-053: a record correction within 48 h (version 2, net delta); the patient copy as FO (a PDF).
    await as(DOC, (db) => correctRecord(db, key(), examId, { plan_note: "Kontrol dua minggu" }, "Rencana kontrol terlewat"));
    expect((await as(RO, (db) => getRecord(db, examId))).versions.map((v) => [v.version, v.kind])).toEqual([[1, "original"], [2, "correction"]]);
    const copy = await as(FO, (db) => requestRecordCopy(db, key(), patient, "Permintaan pasien"));
    expect(copy.pdf.subarray(0, 8).toString("latin1")).toBe("%PDF-1.4");

    // Content-free: events, audit reasons and notifications carry no patient or clinical text.
    const ev = JSON.stringify((await h.admin.query(`select type, payload from domain_events where tenant_id = $1`, [tenantId])).rows);
    expect(ev).not.toMatch(/Pasien Rahasia|Akne|Amoksisilin|Bengkak|nasolabial|istirahat|Glabela/);
    const au = (await h.admin.query(`select reason from audit_events where tenant_id = $1 and reason is not null and action <> 'break_glass'`, [tenantId])).rows;
    expect(au).toEqual([]);
    const no = JSON.stringify((await h.admin.query(`select * from notifications where tenant_id = $1`, [tenantId])).rows);
    expect(no).not.toMatch(/Pasien Rahasia|Bengkak|nasolabial/);
  }, 120_000);
});
