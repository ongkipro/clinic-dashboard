// T-053 Done-when: scenario PR-13 (a record signed 50 hours ago is corrected only through records-officer or
// facility-head approval; the prior version stays readable), CLIN-014 (a new visit's examination is a new
// timepoint; the old record unchanged), CLIN-023 (a correction is a new version holding the net delta), the
// patient record copy of PR-49 (FO request logged; a PDF of record content), and PR-3 acting role (an owner who
// also holds Dokter signs as Dokter). Plus the plan review: second factor, author only, 48 h boundary, one
// pending correction, authorship of approved versions, guards, retention, readers, events, cross-tenant.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { tabsFor } from "../../src/components/shell/nav";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { cancelApproval, decideApproval } from "../../src/modules/approvals/approvals";
import { examSheet, openExam, saveExam, setMark } from "../../src/modules/clinical/exam/exam";
import { correctRecord, getRecord, requestRecordCopy, retentionUntil, signRecord, type StepUp } from "../../src/modules/clinical/records/records";
import { switchContext } from "../../src/modules/org/context/context";
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
const TABLES = ["record_versions", "record_corrections", "record_copy_requests"];
const STEP: StepUp = { verified: true }; // the step-up proof a server action produces after a TOTP check (UI task)

async function tenant(state = "live"): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ($1) returning id`, [state])).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Rekam Medis Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
  return { tenantId, b1: await br("R1"), b2: await br("R2") };
}
async function person(t: T, roles: Role | Role[], ...branches: string[]): Promise<P> {
  const rs = Array.isArray(roles) ? roles : [roles];
  const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`rmd${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Rekam ${n}` });
  for (const role of rs) {
    const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
    if (!TENANT_WIDE.includes(role)) for (const b of branches.length ? branches : [t.b1]) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  }
  return { acc, staffId, tenantId: t.tenantId, role: rs[0], branch: TENANT_WIDE.includes(rs[0]) ? undefined : branches[0] ?? t.b1 };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>, role?: Role, branch?: string) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: role ?? p.role, activeBranchId: branch ?? (role && !TENANT_WIDE.includes(role) ? p.branch ?? undefined : p.branch) }), fn);
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
const key = () => crypto.randomUUID();

async function patient(t: T, name = "Pasien Rekam"): Promise<string> {
  return (await h.admin.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation, education, marital_status, registered_branch_id, created_by, created_as)
     select $1, 'RM-' || lpad((count(*) + 1)::text, 6, '0'), $2, '1990-01-01', 'female', 'newborn_via_guardian', 'Fixture sintetis', 'islam', 'Karyawan', 's1', 'kawin', $3,
            (select s.id from staff s where s.tenant_id = $1 limit 1), 'fo_cashier' from patients where tenant_id = $1 returning id`,
    [t.tenantId, name, t.b1],
  )).rows[0].id as string;
}
// A walk-in visit `ago` days back, or at an exact time (ISO text).
async function visit(t: T, patientId: string, branch = t.b1, ago: number | string = 0): Promise<string> {
  return (await h.admin.query(
    `insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by, checked_in_at)
     values ($1, $2, $3, 'walk_in', (select s.id from staff s where s.tenant_id = $1 limit 1),
             case when $4 ~ '^[0-9]+$' then now() - make_interval(days => $4::int) else $4::timestamptz end) returning id`,
    [t.tenantId, branch, patientId, String(ago)],
  )).rows[0].id as string;
}
const close = (v: string) => h.admin.query(`update visits set closed_at = checked_in_at + interval '1 hour', closed_by = checked_in_by where id = $1`, [v]);
// A draft examination by `doc` on a fresh visit of `p` with an assessment; returns visit and examination.
async function draft(t: T, doc: P, p: string, assessment = "Akne vulgaris ringan", ago = 0) {
  const v = await visit(t, p, doc.branch ?? t.b1, ago);
  const { examId } = await as(doc, (db) => openExam(db, key(), v), "doctor");
  await as(doc, (db) => saveExam(db, key(), examId, { subjective: "Jerawat di dagu", assessment, icd10_codes: ["L70.0"], vitals: { nadi: 80 } }), "doctor");
  return { v, examId };
}
// Moves a signature into the past (the database owner stands in for time passing).
async function age(examId: string, hours: number) {
  await h.admin.query(`alter table examinations disable trigger examinations_guard`);
  try {
    await h.admin.query(`update examinations set signed_at = signed_at - make_interval(hours => $2) where id = $1`, [examId, hours]);
  } finally {
    await h.admin.query(`alter table examinations enable always trigger examinations_guard`);
  }
}
const audits = async (id: string) => (await h.admin.query(`select action, outcome, reason_code, acting_role from audit_events where object_id = $1 order by seq`, [id])).rows;

let A: T;
let B: T;
let OWN: P; let DOC: P; let DOC2: P; let DOCB2: P; let RO: P; let FH: P; let FO: P; let NUR: P; let BC: P; let FIN: P; let OD: P;
let BDOC: P; let BFO: P;

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 6 });
  owner = new pg.Pool({ connectionString: h.ownerUrl(), max: 2 });
  owner.on("error", () => {});
  A = await tenant();
  B = await tenant();
  OWN = await person(A, "owner");
  DOC = await person(A, "doctor", A.b1); DOC2 = await person(A, "doctor", A.b1); DOCB2 = await person(A, "doctor", A.b2);
  RO = await person(A, "records_officer", A.b1); FH = await person(A, "facility_head", A.b1); FO = await person(A, "fo_cashier", A.b1);
  NUR = await person(A, "nurse", A.b1); BC = await person(A, "bc", A.b1); FIN = await person(A, "finance");
  OD = await person(A, ["owner", "doctor"], A.b1); // PR-3: an owner who also holds Dokter
  BDOC = await person(B, "doctor", B.b1); BFO = await person(B, "fo_cashier", B.b1);
}, 300_000);
afterAll(async () => {
  await app?.end();
  await owner?.end();
  await h?.close();
});

describe("signing (PR-13, PR-3)", () => {
  it("the author signs a draft: version 1 is the signed snapshot; the row and its parts are final; idempotent", async () => {
    const { v, examId } = await draft(A, DOC, await patient(A));
    await as(DOC, (db) => setMark(db, key(), examId, { template: "face_front", layer: "keluhan", x: 100, y: 200, label: "Papul" }));
    const k = key();
    const s1 = await as(DOC, (db) => signRecord(db, k, examId, STEP));
    expect(await as(DOC, (db) => signRecord(db, k, examId, STEP))).toEqual({ versionId: s1.versionId, replayed: true });
    expect((await as(DOC, (db) => signRecord(db, key(), examId, STEP))).versionId).toBe(s1.versionId);
    const e = (await h.admin.query(`select state, signed_by, signed_as, content_hash from examinations where id = $1`, [examId])).rows[0];
    expect(e).toMatchObject({ state: "signed", signed_by: DOC.staffId, signed_as: "doctor" });
    const r = await as(DOC, (db) => getRecord(db, examId));
    expect(r.versions.map((x) => [x.version, x.kind])).toEqual([[1, "original"]]);
    expect(r.current).toMatchObject({ subjective: "Jerawat di dagu", assessment: "Akne vulgaris ringan", icd10_codes: ["L70.0"], vitals: { nadi: 80 } });
    expect(r.current.marks).toHaveLength(1);
    expect(r.content_hash).toBe(e.content_hash);
    expect(r.versions[0].content_hash).toBe(e.content_hash);
    expect((await h.admin.query(`select encode(sha256(convert_to(content::text, 'UTF8')), 'hex') = content_hash as ok from record_versions where examination_id = $1`, [examId])).rows[0].ok).toBe(true);
    expect((await h.admin.query(`select doctor from visits where id = $1`, [v])).rows[0].doctor).toBe("done");
    // Final: the row, its parts and drafting are refused.
    await expect(h.admin.query(`update examinations set assessment = 'x' where id = $1`, [examId])).rejects.toThrow(/signed examination is final/);
    await expect(h.admin.query(`delete from face_map_marks where examination_id = $1`, [examId])).rejects.toThrow(/signed examination is final/);
    expect(await code(as(DOC, (db) => saveExam(db, key(), examId, { assessment: "x" })))).toBe("ERR_VERSION_CONFLICT");
    // Signing changes only the state and the signature.
    const { examId: other } = await draft(A, DOC, await patient(A));
    await expect(h.admin.query(`update examinations set state = 'signed', signed_at = now(), signed_by = author_id, signed_as = 'doctor', content_hash = repeat('b', 64), assessment = 'diam-diam' where id = $1`, [other]))
      .rejects.toThrow(/only the state and the signature/);
    await expect(h.admin.query(`update examinations set state = 'signed' where id = $1`, [other])).rejects.toThrow(/examinations_state_check/);
    await expect(h.admin.query(`update examinations set state = 'signed', signed_at = now(), signed_by = $2, signed_as = 'doctor', content_hash = repeat('b', 64) where id = $1`, [other, DOC2.staffId]))
      .rejects.toThrow(/examinations_state_check/);
  });

  it("only the author, acting as Dokter, with a second factor and a step-up; after the visit closed too", async () => {
    const { v, examId } = await draft(A, DOC, await patient(A));
    for (const who of [RO, FH, FO, NUR, BC, OWN]) expect(await code(as(who, (db) => signRecord(db, key(), examId, STEP))), who.role).toBe("ERR_FORBIDDEN");
    expect(await code(as(DOC2, (db) => signRecord(db, key(), examId, STEP)))).toBe("ERR_FORBIDDEN");
    expect(await code(as(DOCB2, (db) => signRecord(db, key(), examId, STEP)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(DOC, (db) => signRecord(db, key(), examId, {} as StepUp)))).toBe("ERR_FORBIDDEN");
    expect(await code(as(DOC, (db) => signRecord(db, key(), examId, undefined as unknown as StepUp)))).toBe("ERR_FORBIDDEN");
    await h.admin.query(`update auth_user set two_factor_enabled = false where id = $1`, [DOC.acc]);
    try {
      const e = await as(DOC, (db) => signRecord(db, key(), examId, STEP)).catch((x) => x);
      expect(e).toBeInstanceOf(CommandError);
      expect((e as { reason?: string }).reason).toBe("second_factor_required");
    } finally {
      await h.admin.query(`update auth_user set two_factor_enabled = true where id = $1`, [DOC.acc]);
    }
    expect((await h.admin.query(`select state from examinations where id = $1`, [examId])).rows[0].state).toBe("draft");
    // After the visit closed: signing works and the closed visit is untouched.
    await close(v);
    await as(DOC, (db) => signRecord(db, key(), examId, STEP));
    expect((await h.admin.query(`select state from examinations where id = $1`, [examId])).rows[0].state).toBe("signed");
    expect((await h.admin.query(`select doctor from visits where id = $1`, [v])).rows[0].doctor).toBe("in_progress");
    // A tenant in exit cannot sign.
    const X = await tenant("exit");
    const xd = await person(X, "doctor", X.b1);
    expect(await code(as(xd, (db) => signRecord(db, key(), crypto.randomUUID(), STEP)))).toBe("ERR_TENANT_SUSPENDED");
  });

  it("scenario PR-3: an owner who also holds Dokter switches to Dokter and signs; signature and audit say Dokter", async () => {
    const sel = await switchContext(app, OD.acc, { tenantId: A.tenantId, role: "owner" }, { kind: "role", role: "doctor" });
    expect(sel.role).toBe("doctor");
    expect(tabsFor("doctor").map((t) => t.label)).toEqual(tabsFor(sel.role as Role).map((t) => t.label));
    expect(tabsFor("doctor").map((t) => t.id)).toContain("antrean-dokter");
    const { examId } = await draft(A, { ...OD, role: "doctor", branch: A.b1 }, await patient(A));
    // Acting as owner the same person cannot sign.
    expect(await code(as(OD, (db) => signRecord(db, key(), examId, STEP), "owner"))).toBe("ERR_FORBIDDEN");
    await as(OD, (db) => signRecord(db, key(), examId, STEP), "doctor", A.b1);
    expect((await h.admin.query(`select signed_by, signed_as from examinations where id = $1`, [examId])).rows[0]).toEqual({ signed_by: OD.staffId, signed_as: "doctor" });
    expect((await audits(examId)).filter((r) => r.action === "sign")).toEqual([{ action: "sign", outcome: "success", reason_code: "record_signed", acting_role: "doctor" }]);
  });
});

describe("corrections (PR-13, CLIN-023)", () => {
  it("within 48 h the author writes version 2 at once holding only the net delta; a no-op is refused", async () => {
    const { examId } = await draft(A, DOC, await patient(A));
    await as(DOC, (db) => signRecord(db, key(), examId, STEP));
    await age(examId, 47);
    const out = await as(DOC, (db) => correctRecord(db, key(), examId, { assessment: "Akne vulgaris sedang", subjective: "Jerawat di dagu" }, "Salah ketik derajat"));
    expect(out.kind).toBe("version");
    const r = await as(DOC, (db) => getRecord(db, examId));
    expect(r.versions.map((x) => x.version)).toEqual([1, 2]);
    expect(r.versions[1]).toMatchObject({ kind: "correction", delta: { assessment: "Akne vulgaris sedang" }, reason: "Salah ketik derajat", created_by: DOC.staffId, created_as: "doctor" });
    expect(Object.keys(r.versions[1].delta!)).toEqual(["assessment"]);
    expect(r.versions[0].content.assessment).toBe("Akne vulgaris ringan");
    expect(r.current).toMatchObject({ assessment: "Akne vulgaris sedang", subjective: "Jerawat di dagu", icd10_codes: ["L70.0"] });
    expect((await h.admin.query(`select assessment from examinations where id = $1`, [examId])).rows[0].assessment).toBe("Akne vulgaris ringan");
    // The sheet shows the current version.
    const v = (await h.admin.query(`select visit_id from examinations where id = $1`, [examId])).rows[0].visit_id as string;
    expect((await as(DOC, (db) => examSheet(db, v))).examination).toMatchObject({ assessment: "Akne vulgaris sedang", state: "signed", version: 2, signed_as: "doctor" });
    // No change, bad input, another doctor, a draft, a short reason.
    expect(await code(as(DOC, (db) => correctRecord(db, key(), examId, { assessment: "Akne vulgaris sedang" }, "Tidak berubah")))).toBe("ERR_INVALID_INPUT");
    for (const bad of [{ marks: [] }, { marks: [], plan_note: "Kontrol" }, { assessment: 3 }, { plan_note: "x".repeat(4001) }, { vitals: { nadi: 900 } }, { icd10_codes: ["x"] },
      { template_values: { fitzpatrick: "IV" } }, {}]) {
      expect(await code(as(DOC, (db) => correctRecord(db, key(), examId, bad as never, "Alasan koreksi"))), JSON.stringify(bad)).toBe("ERR_INVALID_INPUT");
    }
    expect(await code(as(DOC, (db) => correctRecord(db, key(), examId, { plan_note: "x" }, "ab")))).toBe("ERR_INVALID_INPUT");
    expect(await code(as(DOC2, (db) => correctRecord(db, key(), examId, { plan_note: "Kontrol" }, "Alasan koreksi")))).toBe("ERR_FORBIDDEN");
    for (const who of [RO, FH, FO]) expect(await code(as(who, (db) => correctRecord(db, key(), examId, { plan_note: "Kontrol" }, "Alasan koreksi")))).toBe("ERR_FORBIDDEN");
    // The author holding records officer too, acting as records officer, is refused (only as Dokter).
    const dr = await person(A, ["doctor", "records_officer"], A.b1);
    const { examId: own } = await draft(A, dr, await patient(A));
    await as(dr, (db) => signRecord(db, key(), own, STEP), "doctor");
    expect(await code(as(dr, (db) => correctRecord(db, key(), own, { plan_note: "Kontrol" }, "Alasan koreksi"), "records_officer"))).toBe("ERR_FORBIDDEN");
    const { examId: d } = await draft(A, DOC, await patient(A));
    expect(await code(as(DOC, (db) => correctRecord(db, key(), d, { plan_note: "Kontrol" }, "Alasan koreksi")))).toBe("ERR_VERSION_CONFLICT");
    expect(await code(as(DOC, (db) => getRecord(db, d)))).toBe("ERR_NOT_FOUND");
  });

  it("scenario PR-13: 50 h after signing a correction needs RO or FH approval; the prior version stays readable", async () => {
    const { examId } = await draft(A, DOC, await patient(A));
    await as(DOC, (db) => signRecord(db, key(), examId, STEP));
    await age(examId, 50);
    const out = await as(DOC, (db) => correctRecord(db, key(), examId, { icd10_codes: ["L70.1"] }, "Kode diagnosis keliru"));
    expect(out.kind).toBe("pending");
    const approvalId = (out as { approval_id: string }).approval_id;
    let r = await as(DOC, (db) => getRecord(db, examId));
    expect(r.versions).toHaveLength(1);
    expect(r.corrections).toEqual([expect.objectContaining({ state: "pending", delta: { icd10_codes: ["L70.1"] }, approval_id: approvalId })]);
    // The approval type: requested by the doctor, decided by the records officer or the facility head.
    expect((await h.admin.query(`select requester_roles, approver_roles, owner_self from approval_types where key = 'record_late_correction'`)).rows[0])
      .toEqual({ requester_roles: ["doctor"], approver_roles: ["records_officer", "facility_head"], owner_self: false });
    // One pending correction per examination.
    expect(await code(as(DOC, (db) => correctRecord(db, key(), examId, { plan_note: "Kontrol" }, "Alasan lain")))).toBe("ERR_VERSION_CONFLICT");
    // The requesting doctor cannot decide; a nurse or FO cannot either; the records officer approves.
    expect(await code(as(DOC, (db) => decideApproval(db, approvalId, true)))).not.toBe("ok");
    expect(await code(as(FO, (db) => decideApproval(db, approvalId, true)))).not.toBe("ok");
    await as(RO, (db) => decideApproval(db, approvalId, true));
    r = await as(RO, (db) => getRecord(db, examId));
    expect(r.versions.map((x) => [x.version, x.kind, x.approval_id ?? null])).toEqual([[1, "original", null], [2, "correction", approvalId]]);
    expect(r.versions[1]).toMatchObject({ created_by: DOC.staffId, created_as: "doctor", delta: { icd10_codes: ["L70.1"] } });
    expect(r.versions[0].content.icd10_codes).toEqual(["L70.0"]);
    expect(r.current.icd10_codes).toEqual(["L70.1"]);
    expect(r.corrections[0]).toMatchObject({ state: "approved", version_id: r.versions[1].id });
    // A late no-op (the current content already says so) is refused before any approval is opened.
    expect(await code(as(DOC, (db) => correctRecord(db, key(), examId, { icd10_codes: ["L70.1"] }, "Sudah sama")))).toBe("ERR_INVALID_INPUT");
    // A rejected late correction leaves the record as it was; a cancelled one too.
    const o2 = await as(DOC, (db) => correctRecord(db, key(), examId, { plan_note: " Kontrol 2 minggu ", icd10_codes: ["L70.1"] }, "Rencana terlewat"));
    // The pending request stores the net delta (trimmed; the unchanged codes dropped).
    expect((await as(RO, (db) => getRecord(db, examId))).corrections[1]).toMatchObject({ state: "pending", delta: { plan_note: "Kontrol 2 minggu" } });
    expect(Object.keys((await as(RO, (db) => getRecord(db, examId))).corrections[1].delta)).toEqual(["plan_note"]);
    await as(FH, (db) => decideApproval(db, (o2 as { approval_id: string }).approval_id, false, "Tidak perlu"));
    const o3 = await as(DOC, (db) => correctRecord(db, key(), examId, { plan_note: "Kontrol 3 minggu" }, "Rencana terlewat"));
    await as(DOC, (db) => cancelApproval(db, (o3 as { approval_id: string }).approval_id));
    r = await as(FH, (db) => getRecord(db, examId));
    expect(r.versions).toHaveLength(2);
    expect(r.corrections.map((c) => c.state)).toEqual(["approved", "rejected", "cancelled"]);
    expect(r.current.plan_note).toBeNull();
  });

  it("the 48 h boundary: 47:59 direct, 48:01 approval", async () => {
    for (const [mins, kind] of [[47 * 60 + 59, "version"], [48 * 60 + 1, "pending"]] as const) {
      const { examId } = await draft(A, DOC, await patient(A));
      await as(DOC, (db) => signRecord(db, key(), examId, STEP));
      await h.admin.query(`alter table examinations disable trigger examinations_guard`);
      try {
        await h.admin.query(`update examinations set signed_at = clock_timestamp() - make_interval(mins => $2) where id = $1`, [examId, mins]);
      } finally {
        await h.admin.query(`alter table examinations enable always trigger examinations_guard`);
      }
      expect((await as(DOC, (db) => correctRecord(db, key(), examId, { plan_note: `Batas ${mins}` }, "Uji batas waktu"))).kind, String(mins)).toBe(kind);
    }
  });
});

describe("CLIN-014: a new assessment is a new timepoint; the old record is unchanged", () => {
  it("a later visit's examination is its own record; the earlier signed record and its versions stay", async () => {
    const p = await patient(A, "Titik Waktu");
    const first = await draft(A, DOC, p, "Akne vulgaris ringan", 30);
    await as(DOC, (db) => signRecord(db, key(), first.examId, STEP));
    await close(first.v);
    const before = await as(DOC, (db) => getRecord(db, first.examId));
    const second = await draft(A, DOC2, p, "Akne vulgaris membaik");
    await as(DOC2, (db) => signRecord(db, key(), second.examId, STEP));
    const after = await as(DOC, (db) => getRecord(db, first.examId));
    expect({ ...after, versions: after.versions.length }).toEqual({ ...before, versions: before.versions.length });
    expect(after.versions).toEqual(before.versions);
    const sheet = await as(DOC2, (db) => examSheet(db, second.v));
    expect(sheet.earlier.map((x) => x.assessment)).toEqual(["Akne vulgaris ringan"]);
    expect(sheet.examination?.assessment).toBe("Akne vulgaris membaik");
    // A correction of the earlier record shows in the timeline as its current version; v1 stays.
    await as(DOC, (db) => correctRecord(db, key(), first.examId, { assessment: "Akne vulgaris ringan-sedang", icd10_codes: ["L70.9"] }, "Derajat diperjelas"));
    const s2 = await as(DOC2, (db) => examSheet(db, second.v));
    expect(s2.earlier.map((x) => [x.assessment, x.icd10_codes])).toEqual([["Akne vulgaris ringan-sedang", ["L70.9"]]]);
    expect((await as(DOC, (db) => getRecord(db, first.examId))).versions[0].content.assessment).toBe("Akne vulgaris ringan");
  });
});

describe("PR-49: the patient record copy", () => {
  it("FO requests a copy: logged (content-free), a PDF of the signed records across the merge cluster; drafts left out", async () => {
    const dup = await patient(A, "Rina Salinan Lama");
    const p = await patient(A, "Rina Salinan");
    const old = await draft(A, DOC, dup, "Dermatitis kontak", 20);
    await as(DOC, (db) => signRecord(db, key(), old.examId, STEP));
    await close(old.v);
    await as(RO, (db) => mergePatients(db, key(), p, dup, "Data ganda pasien yang sama"));
    const now = await draft(A, DOC, p, "Akne (koreksi) \\ uji", 5);
    await as(DOC, (db) => signRecord(db, key(), now.examId, STEP));
    await close(now.v);
    await draft(A, DOC, p, "Draf belum ditandatangani");
    const k = key();
    const out = await as(FO, (db) => requestRecordCopy(db, k, p, "Permintaan pasien"));
    expect(out.recordCount).toBe(2);
    const pdf = out.pdf.toString("latin1");
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(pdf).toContain("Rina Salinan");
    expect(pdf).toContain("Dermatitis kontak");
    expect(pdf).toContain("Akne \\(koreksi\\) \\\\ uji");
    expect(pdf).not.toContain("Draf belum ditandatangani");
    // xref offsets point at the objects.
    const xref = Number(/startxref\n(\d+)/.exec(pdf)![1]);
    expect(pdf.slice(xref, xref + 4)).toBe("xref");
    const offs = [...pdf.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    offs.forEach((o, i) => expect(pdf.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
    // A replay renders the same request again; the log has one row, content-free.
    const again = await as(FO, (db) => requestRecordCopy(db, k, p, "Permintaan pasien"));
    expect(again).toMatchObject({ requestId: out.requestId, replayed: true, recordCount: 2 });
    const rows = (await h.admin.query(`select * from record_copy_requests where patient_id = $1`, [p])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ record_count: 2, requested_by: FO.staffId, requested_as: "fo_cashier", branch_id: A.b1 });
    expect(JSON.stringify(rows)).not.toMatch(/Akne|Dermatitis/);
    expect((await audits(out.requestId)).map((r) => [r.action, r.reason_code])).toEqual([["export", "record_copy_produced"]]);
    const idem = (await h.admin.query(`select result from idempotency_records where key = $1`, [k])).rows;
    expect(JSON.stringify(idem)).not.toMatch(/Akne|Dermatitis|Rina/);
    // Who may: FO, RO, FH; not the doctor, nurse, finance; not another branch's patient.
    for (const who of [RO, FH]) expect((await as(who, (db) => requestRecordCopy(db, key(), p, "Permintaan pasien"))).recordCount).toBe(2);
    for (const who of [DOC, NUR, FIN, BC]) expect(await code(as(who, (db) => requestRecordCopy(db, key(), p, "Permintaan pasien"))), who.role).toBe("ERR_FORBIDDEN");
    const elsewhere = await patient(A, "Hanya Cabang Dua");
    await visit(A, elsewhere, A.b2);
    expect(await code(as(FO, (db) => requestRecordCopy(db, key(), elsewhere, "Permintaan pasien")))).toBe("ERR_NOT_FOUND");
    expect(await code(as(FO, (db) => requestRecordCopy(db, key(), p, "ab")))).toBe("ERR_INVALID_INPUT");
    // Another FO cannot read this request's content.
    const fo2 = await person(A, "fo_cashier", A.b1);
    expect(await code(as(fo2, (db) => db.query(`select record_copy_data($1)`, [out.requestId])))).toBe("raw:P0002"); // not found
    // A patient with no signed record gets an empty copy.
    const none = await patient(A, "Belum Ada Rekam");
    await visit(A, none);
    const empty = await as(FO, (db) => requestRecordCopy(db, key(), none, "Permintaan pasien"));
    expect(empty.recordCount).toBe(0);
    expect(empty.pdf.toString("latin1")).toContain("Belum ada rekam medis yang ditandatangani.");
  });
});

describe("retention, guards, readers, events, cross-tenant", () => {
  it("retention: 25 years from the last visit's local date, across the merge cluster", async () => {
    const p = await patient(A, "Retensi");
    await close(await visit(A, p, A.b1, "2025-03-01 10:00+00"));
    await visit(A, p, A.b1, "2026-01-15 20:00+00"); // 16 Jan 2026 in Jakarta: the last visit
    expect(await as(RO, (db) => retentionUntil(db, p))).toBe("2051-01-16");
    for (const who of [DOC, FO]) expect(await code(as(who, (db) => retentionUntil(db, p)))).toBe("ERR_FORBIDDEN");
    expect(await code(as(RO, (db) => retentionUntil(db, crypto.randomUUID())))).toBe("ERR_NOT_FOUND");
  });

  it("versions, corrections and copy requests are never deleted or rewritten; triggers always enabled", async () => {
    const { examId } = await draft(A, DOC, await patient(A));
    await as(DOC, (db) => signRecord(db, key(), examId, STEP));
    await age(examId, 50);
    const o = await as(DOC, (db) => correctRecord(db, key(), examId, { plan_note: "Kontrol" }, "Terlewat"));
    await expect(h.admin.query(`delete from record_versions where examination_id = $1`, [examId])).rejects.toThrow(/never deleted/);
    await expect(h.admin.query(`update record_versions set reason = 'x' where examination_id = $1`, [examId])).rejects.toThrow(/never changes/);
    await expect(h.admin.query(`delete from examinations where id = $1`, [examId])).rejects.toThrow(/never deleted/);
    await expect(h.admin.query(`update record_corrections set reason = 'lain' where id = $1`, [o.id])).rejects.toThrow(/decided once/);
    await expect(h.admin.query(`update record_corrections set state = 'cancelled', decided_at = now(), reason = 'diganti' where id = $1`, [o.id])).rejects.toThrow(/decided once/);
    await expect(h.admin.query(`update record_corrections set state = 'cancelled', decided_at = now(), delta = '{"plan_note":"lain"}' where id = $1`, [o.id])).rejects.toThrow(/decided once/);
    await expect(h.admin.query(`delete from record_corrections where id = $1`, [o.id])).rejects.toThrow(/never deleted/);
    await as(RO, (db) => decideApproval(db, (o as { approval_id: string }).approval_id, false, "Tidak perlu"));
    await expect(h.admin.query(`update record_corrections set state = 'approved' where id = $1`, [o.id])).rejects.toThrow(/decided once/);
    for (const t of TABLES) await expect(h.admin.query(`truncate ${t} cascade`)).rejects.toThrow();
    const trig = (await h.admin.query(`select tgname, tgenabled from pg_trigger where tgrelid = any($1::regclass[]) and not tgisinternal order by 1`, [TABLES])).rows;
    expect(trig.map((r) => `${r.tgname}:${r.tgenabled}`)).toEqual([
      "record_copy_requests_guard:A", "record_copy_requests_no_truncate:A", "record_corrections_guard:A", "record_corrections_no_truncate:A",
      "record_versions_guard:A", "record_versions_no_truncate:A"]);
    expect((await h.admin.query(`select tgenabled from pg_trigger where tgname = 'approvals_record_correction_sync'`)).rows[0].tgenabled).toBe("A");
  });

  it("readers: doctor, FH, RO read versions; others do not; events and audit carry ids and codes only", async () => {
    const { examId } = await draft(A, DOC, await patient(A), "Rahasia klinis");
    await as(DOC, (db) => signRecord(db, key(), examId, STEP));
    await as(DOC, (db) => correctRecord(db, key(), examId, { assessment: "Rahasia klinis kedua" }, "Koreksi rahasia"));
    const rows = (who: P) => as(who, async (db) => (await db.query(`select count(*)::int as n from record_versions where examination_id = $1`, [examId])).rows[0].n as number);
    for (const who of [DOC, DOC2, FH, RO]) expect(await rows(who)).toBe(2);
    for (const who of [FO, NUR, BC, OWN, FIN, DOCB2]) expect(await rows(who)).toBe(0);
    for (const who of [FH, RO]) expect((await as(who, (db) => getRecord(db, examId))).versions).toHaveLength(2);
    for (const who of [FO, NUR, BC, DOCB2]) expect(await code(as(who, (db) => getRecord(db, examId))), who.role).toBe("ERR_NOT_FOUND");
    expect((await audits(examId)).map((r) => [r.action, r.reason_code])).toEqual(expect.arrayContaining([["sign", "record_signed"], ["sign", "record_corrected"], ["clinical_read", "record_viewed"]]));
    const ev = (await h.admin.query(`select type, payload from domain_events where aggregate_id = $1 and type in ('ExaminationSigned','RecordCorrected') order by occurred_at, id`, [examId])).rows;
    expect(ev.map((x) => x.type)).toEqual(["ExaminationSigned", "RecordCorrected"]);
    expect(JSON.stringify(ev)).not.toMatch(/rahasia/i);
    expect(Object.keys(ev[0].payload).sort()).toEqual(["branch_id", "examination_id", "version_id", "visit_id"]);
    expect(Object.keys(ev[1].payload).sort()).toEqual(["change", "examination_id", "version_id"]);
    // Copy requests: FO, RO, FH of the branch on the wall clock.
    const p = (await h.admin.query(`select patient_id from examinations where id = $1`, [examId])).rows[0].patient_id as string;
    const { requestId } = await as(FO, (db) => requestRecordCopy(db, key(), p, "Permintaan pasien"));
    const reqs = (who: P) => as(who, async (db) => (await db.query(`select count(*)::int as n from record_copy_requests where id = $1`, [requestId])).rows[0].n as number);
    for (const who of [FO, RO, FH]) expect(await reqs(who)).toBe(1);
    for (const who of [DOC, NUR, OWN]) expect(await reqs(who)).toBe(0);
    const f = await person(A, "fo_cashier", A.b1);
    const ctx = await resolveContext(app, f.acc, { tenantId: A.tenantId, actingRole: "fo_cashier", activeBranchId: A.b1 });
    await h.admin.query(`delete from staff_branches where staff_id = $1`, [f.staffId]);
    expect(await withTenantContext(app, ctx, async (db) => (await db.query(`select count(*)::int as n from record_copy_requests where id = $1`, [requestId])).rows[0].n)).toBe(0);
  });

  it("vendor class clinical; helpers not executable; cross-tenant reads and writes nothing", async () => {
    const kinds = (await h.admin.query(`select support_class from support_object_kinds where table_name = any($1::text[])`, [TABLES.map((t) => `public.${t}`)])).rows;
    expect(kinds.map((k) => k.support_class)).toEqual(["clinical", "clinical", "clinical"]);
    for (const f of ["records_guard()", "record_correction_sync()", "record_content(examinations)", "record_hash(jsonb)", "record_apply(jsonb,jsonb)",
      "record_delta(jsonb,jsonb)", "record_current(uuid,uuid)", "record_write_version(examinations,jsonb,text,uuid,text,uuid)", "record_copy_rows(uuid,uuid)", "record_copy_actor()"]) {
      for (const r of ["clinic_app", "clinic_vendor", "clinic_operator"]) {
        expect((await h.admin.query(`select has_function_privilege($1, $2, 'execute') as ok`, [r, `public.${f}`])).rows[0].ok, `${r} ${f}`).toBe(false);
      }
    }
    const p = await patient(A);
    const { examId } = await draft(A, DOC, p);
    await as(DOC, (db) => signRecord(db, key(), examId, STEP));
    for (const t of TABLES) expect(await as(BDOC, async (db) => (await db.query(`select count(*)::int as n from ${t}`)).rows[0].n)).toBe(0);
    expect(await code(as(BDOC, (db) => signRecord(db, key(), examId, STEP)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BDOC, (db) => correctRecord(db, key(), examId, { plan_note: "x" }, "Alasan uji")))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BDOC, (db) => getRecord(db, examId)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BFO, (db) => requestRecordCopy(db, key(), p, "Permintaan pasien")))).toBe("ERR_NOT_FOUND");
  });
});
