// T-058 Done-when: scenario PR-74 (02:715) — a doctor creates a surat keterangan from a template; when the doctor
// signs it, it is stored as part of the medical record and cannot be edited, only corrected by a new version.
// Plus the plan review: template versions (immutable once used, retire), placeholders (closed set, required,
// malformed, patient data refused), roles and kinds, preview without patient rows, the examining doctor, SIP,
// late correction through the approval beside the record correction, readers, guards, audit and events
// content-free, exit, cross-tenant.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { cancelApproval, decideApproval } from "../../src/modules/approvals/approvals";
import { openExam, saveExam } from "../../src/modules/clinical/exam/exam";
import { correctRecord, signRecord, type StepUp } from "../../src/modules/clinical/records/records";
import {
  correctLetter, createLetter, getLetter, getTemplate, letterOptions, letterPdf, listLetters, listTemplates, retireTemplate, saveLetter, saveTemplate, signLetter,
} from "../../src/modules/documents/documents";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { createHarness, type Harness } from "../rls/harness";

process.env.DEPLOY_ENV = "local"; // synthetic data (MIG-2)

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let n = 0;
type T = { tenantId: string; b1: string; b2: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
const TENANT_WIDE = ["owner", "finance", "admin_pusat", "purchasing", "marketing", "central_cs", "auditor"];
const TABLES = ["document_templates", "document_template_versions", "medical_letters", "medical_letter_versions", "medical_letter_corrections"];
const STEP: StepUp = { verified: true };
const LETTER = `{{klinik.nama}}\nSURAT KETERANGAN\nTanggal {{tanggal}}\nYang bertanda tangan menerangkan bahwa {{pasien.nama}} ({{pasien.no_rm}}) telah diperiksa.\nKeluhan: {{pemeriksaan.keluhan}}\n{{dokter.nama}} — SIP {{dokter.sip}}`;

async function tenant(state = "live"): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ($1) returning id`, [state])).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Klinik Surat Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
  return { tenantId, b1: await br("S1"), b2: await br("S2") };
}
async function person(t: T, roles: Role | Role[], ...branches: string[]): Promise<P> {
  const rs = Array.isArray(roles) ? roles : [roles];
  const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`srt${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Surat ${n}` });
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

async function patient(t: T, name = "Pasien Surat"): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, "");
  return (await h.admin.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation, education,
                           marital_status, registered_branch_id, created_by, created_as)
     select $1, 'RM-' || lpad((count(*) + 1)::text, 6, '0'), $2, '1990-01-01', 'female', 'nik', $4, $5, 'islam', 'Karyawan', 's1', 'kawin', $3,
            (select s.id from staff s where s.tenant_id = $1 limit 1), 'fo_cashier' from patients where tenant_id = $1 returning id`,
    [t.tenantId, name, t.b1, `v1.1.${id}.${id}.${id}`, (id + id).slice(0, 43)],
  )).rows[0].id as string;
}
async function visit(t: T, patientId: string, branch = t.b1): Promise<string> {
  return (await h.admin.query(
    `insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', (select s.id from staff s where s.tenant_id = $1 limit 1)) returning id`,
    [t.tenantId, branch, patientId],
  )).rows[0].id as string;
}
// A verified SIP for a doctor at a branch (recorded by the owner, verified by the facility head).
async function sip(t: T, p: P, branch: string, number: string) {
  for (const [kind, b, exp] of [["str", null, null], ["sip", branch, "2099-12-31"]] as const) {
    const id = (await h.admin.query(
      `insert into staff_credentials (tenant_id, staff_id, kind, number, issuer, profession, branch_id, valid_from, expires_on, recorded_by)
       values ($1, $2, $3, $4, 'Konsil Kesehatan', 'dokter', $5, '2024-01-01', $6, $7) returning id`,
      [t.tenantId, p.staffId, kind, kind === "sip" ? number : `STR-${++n}`, b, exp, OWN.staffId])).rows[0].id as string;
    await h.admin.query(`update staff_credentials set state = 'verified', decided_by = $2, decided_at = now() where id = $1`, [id, FH.staffId]);
  }
}
// Moves a letter's signature into the past (the database owner stands in for time passing).
async function age(letterId: string, hours: number) {
  await h.admin.query(`alter table medical_letters disable trigger medical_letters_guard`);
  try {
    await h.admin.query(`update medical_letters set signed_at = signed_at - make_interval(hours => $2) where id = $1`, [letterId, hours]);
  } finally {
    await h.admin.query(`alter table medical_letters enable always trigger medical_letters_guard`);
  }
}
const audits = async (id: string) => (await h.admin.query(`select action, reason_code, reason from audit_events where object_id = $1 order by seq`, [id])).rows;

let A: T;
let B: T;
let OWN: P; let AP: P; let FH: P; let DOC: P; let DOC2: P; let RO: P; let NUR: P; let FO: P; let MGR: P; let DOCB2: P; let BDOC: P; let BAP: P;
let triggersAtStart: { tgname: string; tgenabled: string }[]; // read before any test toggles a guard (age() re-enables it)
let tplVersion: string; // the active version of A's surat keterangan template
let tplId: string;

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 6 });
  owner = new pg.Pool({ connectionString: h.ownerUrl(), max: 2 });
  owner.on("error", () => {});
  A = await tenant();
  B = await tenant();
  OWN = await person(A, "owner"); AP = await person(A, "admin_pusat"); FH = await person(A, "facility_head", A.b1);
  DOC = await person(A, "doctor", A.b1); DOC2 = await person(A, "doctor", A.b1); RO = await person(A, "records_officer", A.b1);
  NUR = await person(A, "nurse", A.b1); FO = await person(A, "fo_cashier", A.b1); MGR = await person(A, "manager", A.b1);
  DOCB2 = await person(A, "doctor", A.b2);
  BDOC = await person(B, "doctor", B.b1); BAP = await person(B, "admin_pusat");
  triggersAtStart = (await h.admin.query(`select tgname, tgenabled from pg_trigger where (tgrelid = any($1::regclass[]) or tgname = 'approvals_letter_correction_sync') and not tgisinternal order by 1`,
    [TABLES])).rows;
  await sip(A, DOC, A.b1, "SIP-DOK-001");
  const t = await as(FH, (db) => saveTemplate(db, key(), null, { kind: "letter", letterType: "surat_keterangan", name: "Surat Keterangan Sehat", body: LETTER, paper: "a4" }));
  tplId = t.templateId;
  tplVersion = t.versionId;
}, 300_000);
afterAll(async () => {
  await app?.end();
  await owner?.end();
  await h?.close();
});

describe("scenario PR-74: signed letter", () => {
  it("a doctor creates a surat keterangan from a template; signed, it is part of the record, never edited, only corrected by a new version", async () => {
    const pid = await patient(A, "Pasien Rahasia Surat");
    const v = await visit(A, pid);
    const { examId } = await as(DOC, (db) => openExam(db, key(), v));
    await as(DOC, (db) => saveExam(db, key(), examId, { subjective: "Kemerahan di pipi" }));
    const { letterId } = await as(DOC, (db) => createLetter(db, key(), v, tplVersion));
    let l = await as(DOC, (db) => getLetter(db, letterId));
    // Placeholders resolved from the tenant, the patient, the examination and the doctor's SIP.
    expect(l.body).toContain("PT Klinik Surat Sintetis");
    expect(l.body).toContain("Pasien Rahasia Surat (RM-");
    expect(l.body).toContain("Keluhan: Kemerahan di pipi");
    expect(l.body).toContain("SIP SIP-DOK-001");
    expect(l.body).not.toMatch(/\{\{|\}\}/);
    expect([l.state, l.letter_type, l.own]).toEqual(["draft", "surat_keterangan", true]);
    // The draft can be edited by its author; the template version is now used.
    await as(DOC, (db) => saveLetter(db, key(), letterId, `${l.body}\nIstirahat 2 hari.`));
    expect((await h.admin.query(`select used_at from document_template_versions where id = $1`, [tplVersion])).rows[0].used_at).not.toBeNull();
    // Signing needs the step-up proof; then the body is frozen as version 1 and stored with the record.
    expect(await reason(as(DOC, (db) => signLetter(db, key(), letterId, {} as StepUp)))).toBe("step_up_required");
    const { versionId } = await as(DOC, (db) => signLetter(db, key(), letterId, STEP));
    l = await as(DOC, (db) => getLetter(db, letterId));
    expect([l.state, l.versions.length, l.versions[0].version, l.versions[0].kind, l.versions[0].id]).toEqual(["signed", 1, 1, "original", versionId]);
    expect(l.body).toContain("Istirahat 2 hari.");
    expect(letterPdf(l).subarray(0, 5).toString()).toBe("%PDF-");
    // It cannot be edited ...
    expect(await code(as(DOC, (db) => saveLetter(db, key(), letterId, "Isi baru yang lain sekali")))).toBe("ERR_VERSION_CONFLICT");
    await expect(h.admin.query(`update medical_letters set body = body || ' diam-diam' where id = $1`, [letterId])).rejects.toThrow(/only by a new version/);
    await expect(h.admin.query(`update medical_letter_versions set body = body || ' x' where letter_id = $1`, [letterId])).rejects.toThrow(/never change/);
    // ... only corrected by a new version (within 48 h by the author), the original kept.
    const c = await as(DOC, (db) => correctLetter(db, key(), letterId, l.body.replace("2 hari", "3 hari"), "Salah tulis lama istirahat"));
    expect(c.kind).toBe("version");
    l = await as(DOC, (db) => getLetter(db, letterId));
    expect(l.versions.map((x) => [x.version, x.kind, x.reason])).toEqual([[2, "correction", "Salah tulis lama istirahat"], [1, "original", null]]);
    expect(l.body).toContain("3 hari");
    expect(l.versions[1].body).toContain("2 hari");
    expect(await code(as(DOC, (db) => correctLetter(db, key(), letterId, l.body, "Tidak berubah")))).toBe("ERR_INVALID_INPUT");
    // Part of the medical record: the record readers read it; others do not.
    for (const who of [FH, RO]) expect((await as(who, (db) => getLetter(db, letterId))).state, who.role).toBe("signed");
    for (const who of [NUR, FO, MGR, OWN, AP]) expect(await code(as(who, (db) => getLetter(db, letterId))), who.role).toBe("ERR_FORBIDDEN");
    // Direct reads through RLS: the record readers of the branch only.
    const direct = (who: P) => as(who, async (db) => (await db.query(`select (select count(*) from medical_letters where id = $1)::int + (select count(*) from medical_letter_versions where letter_id = $1)::int as n`, [letterId])).rows[0].n as number);
    for (const who of [NUR, FO, MGR, OWN, AP, DOCB2]) expect(await direct(who), who.role).toBe(0);
    expect(await direct(RO)).toBe(3);
    // A draft has no PDF.
    const d0 = await as(DOC, (db) => createLetter(db, key(), v, tplVersion));
    expect(() => letterPdf({ ...l, state: "draft" })).toThrow();
    expect(await code(as(DOC, (db) => correctLetter(db, key(), d0.letterId, "Koreksi atas draf yang belum ditandatangani", "Alasan")))).toBe("ERR_VERSION_CONFLICT");
    expect(await code(as(DOCB2, (db) => getLetter(db, letterId)))).toBe("ERR_NOT_FOUND");
    expect((await as(RO, (db) => listLetters(db, { patientId: pid }))).letters.map((x) => x.id).sort()).toEqual([letterId, d0.letterId].sort());
    // Audit and events: no content; idempotency results hold ids only.
    const au = await audits(letterId);
    expect(au.map((r) => [r.action, r.reason_code])).toEqual(expect.arrayContaining([["sign", "letter_created"], ["sign", "letter_saved"], ["sign", "letter_signed"],
      ["sign", "letter_corrected"], ["clinical_read", "letter_viewed"]]));
    expect(au.every((r) => r.reason === null)).toBe(true);
    const ev = (await h.admin.query(`select type, payload from domain_events where aggregate_id = $1 order by occurred_at, id`, [letterId])).rows;
    expect(ev.map((e) => e.type)).toEqual(["LetterSigned", "LetterCorrected"]);
    expect(JSON.stringify(ev)).not.toMatch(/rahasia|kemerahan|istirahat/i);
    const idem = (await h.admin.query(`select result::text as r from idempotency_records where command like 'letter_%' or command like 'template_%'`)).rows;
    expect(idem.every((r) => (r.r ?? "").length < 120)).toBe(true);
    expect(JSON.stringify(idem)).not.toMatch(/rahasia|istirahat/i);
  });

  it("a late correction waits for the record-correction approval; the record correction trigger ignores it", async () => {
    const pid = await patient(A);
    const v = await visit(A, pid);
    const { letterId } = await as(DOC2, (db) => createLetter(db, key(), v, tplVersion));
    await as(DOC2, (db) => signLetter(db, key(), letterId, STEP));
    await age(letterId, 49);
    const body = (await as(DOC2, (db) => getLetter(db, letterId))).body;
    const o = await as(DOC2, (db) => correctLetter(db, key(), letterId, `${body}\nTambahan terlambat.`, "Terlambat menambahkan"));
    expect(o.kind).toBe("pending");
    const approvalId = (o as { approval_id: string }).approval_id;
    expect((await h.admin.query(`select type, subject_kind from approvals where id = $1`, [approvalId])).rows[0]).toEqual({ type: "record_late_correction", subject_kind: "letter_correction" });
    expect(await code(as(DOC2, (db) => correctLetter(db, key(), letterId, `${body}\nLagi.`, "Alasan lain")))).toBe("ERR_VERSION_CONFLICT");
    expect((await as(DOC2, (db) => getLetter(db, letterId))).pending_correction).toBe(true);
    expect(await code(as(DOC2, (db) => decideApproval(db, approvalId, true)))).not.toBe("ok");
    await as(RO, (db) => decideApproval(db, approvalId, true));
    const l = await as(RO, (db) => getLetter(db, letterId));
    expect(l.versions.map((x) => [x.version, x.kind, x.approved])).toEqual([[2, "correction", true], [1, "original", false]]);
    expect(l.body).toContain("Tambahan terlambat.");
    expect((await h.admin.query(`select count(*)::int as n from record_corrections where approval_id = $1`, [approvalId])).rows[0].n).toBe(0);
    // Rejected and cancelled leave the letter as it was.
    const o2 = await as(DOC2, (db) => correctLetter(db, key(), letterId, `${l.body}\nDua.`, "Alasan dua"));
    await as(FH, (db) => decideApproval(db, (o2 as { approval_id: string }).approval_id, false, "Tidak perlu"));
    const o3 = await as(DOC2, (db) => correctLetter(db, key(), letterId, `${l.body}\nTiga.`, "Alasan tiga"));
    await as(DOC2, (db) => cancelApproval(db, (o3 as { approval_id: string }).approval_id));
    expect((await as(RO, (db) => getLetter(db, letterId))).versions).toHaveLength(2);
    expect((await h.admin.query(`select state from medical_letter_corrections where letter_id = $1 order by requested_at`, [letterId])).rows.map((r) => r.state))
      .toEqual(["approved", "rejected", "cancelled"]);
    // The letter trigger acts on letter corrections only: approving a record correction leaves a pending letter one.
    const o4 = await as(DOC2, (db) => correctLetter(db, key(), letterId, `${l.body}\nEmpat.`, "Alasan empat"));
    const ev = await visit(A, await patient(A));
    const { examId } = await as(DOC2, (db) => openExam(db, key(), ev));
    await as(DOC2, (db) => saveExam(db, key(), examId, { subjective: "Keluhan awal" }));
    await as(DOC2, (db) => signRecord(db, key(), examId, STEP));
    await h.admin.query(`alter table examinations disable trigger examinations_guard`);
    try {
      await h.admin.query(`update examinations set signed_at = signed_at - interval '49 hours' where id = $1`, [examId]);
    } finally {
      await h.admin.query(`alter table examinations enable always trigger examinations_guard`);
    }
    const rc = await as(DOC2, (db) => correctRecord(db, key(), examId, { subjective: "Keluhan dikoreksi" }, "Koreksi rekam medis"));
    await as(RO, (db) => decideApproval(db, (rc as { approval_id: string }).approval_id, true));
    expect((await h.admin.query(`select state from medical_letter_corrections where approval_id = $1`, [(o4 as { approval_id: string }).approval_id])).rows[0].state).toBe("pending");
    expect((await as(RO, (db) => getLetter(db, letterId))).versions).toHaveLength(2);
  });
});

describe("templates: versions, placeholders, roles", () => {
  it("Simpan Versi publishes n+1, the used version stays; retire stops new letters; placeholders closed and required", async () => {
    const t = await as(AP, (db) => saveTemplate(db, key(), null, { kind: "letter", letterType: "rujukan", name: "Surat Rujukan", body: LETTER, paper: "a4" }));
    const pid = await patient(A);
    const v = await visit(A, pid);
    await as(DOC, (db) => createLetter(db, key(), v, t.versionId));
    const t2 = await as(AP, (db) => saveTemplate(db, key(), t.templateId, { body: `${LETTER}\nRujukan ke {{cabang.nama}}`, paper: "a4" }));
    const d = await as(AP, (db) => getTemplate(db, t.templateId));
    expect(d.versions.map((x) => [x.version, x.state, x.used])).toEqual([[2, "active", false], [1, "retired", true]]);
    expect(d.versions[1].body).toBe(LETTER);
    expect(d.writable).toBe(true);
    // The retired version cannot start a letter; the new one can.
    const v2 = await visit(A, await patient(A));
    expect(await code(as(DOC, (db) => createLetter(db, key(), v2, t.versionId)))).toBe("ERR_NOT_FOUND");
    await as(DOC, (db) => createLetter(db, key(), v2, t2.versionId));
    // Retire: no new letters; saving again refused.
    await as(OWN, (db) => retireTemplate(db, key(), t.templateId));
    expect((await as(AP, (db) => getTemplate(db, t.templateId))).versions.map((x) => x.state)).toEqual(["retired", "retired"]);
    expect(await reason(as(OWN, (db) => retireTemplate(db, key(), t.templateId)))).toBe("template_retired");
    expect(await reason(as(AP, (db) => saveTemplate(db, key(), t.templateId, { body: LETTER, paper: "a4" })))).toBe("template_retired");
    const v3 = await visit(A, await patient(A));
    expect(await code(as(DOC, (db) => createLetter(db, key(), v3, t2.versionId)))).toBe("ERR_NOT_FOUND");
    expect((await as(DOC, (db) => letterOptions(db, null))).templates.map((x) => x.version_id)).not.toContain(t2.versionId);
    // Placeholders.
    const save = (body: string, kind: "letter" | "receipt" | "consent" | "legal" = "letter", paper: "a4" | "80mm" | "58mm" = "a4", name = "Templat Uji") =>
      as(AP, (db) => saveTemplate(db, key(), null, { kind, ...(kind === "letter" ? { letterType: "resume" as const } : {}), name, body, paper }));
    expect(await reason(save(LETTER.replace("{{dokter.sip}}", "")))).toBe("missing_placeholder");
    expect(await reason(save(`${LETTER} {{pasien.nik}}`))).toBe("unknown_placeholder");
    expect(await reason(save(`${LETTER} {pasien.nama}`))).toBe("malformed_placeholder");
    expect(await reason(save(`${LETTER} {{ pasien.nama }}`))).toBe("malformed_placeholder");
    expect(await reason(save(`${LETTER} RM-000123`))).toBe("patient_data_in_template");
    expect(await reason(save(`${LETTER} NIK 3174012345678901`))).toBe("patient_data_in_template");
    expect(await reason(save(LETTER, "letter", "a4", "Surat rm-000123"))).toBe("patient_data_in_template");
    // Not patient data: phone numbers, dates, NIB (13 digits).
    await save(`${LETTER}\nTelp 081234567890 · 2026-11-10 · NIB 1234567890123`);
    expect(await reason(save(LETTER, "letter", "80mm"))).toBe("paper");
    const receipt = "{{klinik.nama}} {{cabang.alamat}} NPWP {{klinik.npwp}} No {{struk.nomor}} {{tanggal}} {{struk.baris}} Total {{struk.total}}";
    const rc = await save(receipt, "receipt", "58mm", "Struk Kasir");
    // A receipt version cannot start a letter.
    expect(await code(as(DOC, (db) => createLetter(db, key(), v3, rc.versionId)))).toBe("ERR_NOT_FOUND");
    expect(await reason(save(`${receipt} {{dokter.sip}}`, "receipt", "80mm"))).toBe("unknown_placeholder");
    const legal = "Kebijakan privasi {{klinik.nama}} dikelola bersama {{vendor.nama}} per {{tanggal}}.";
    const lg = await save(legal, "legal", "a4", "Kebijakan Privasi");
    // Preview: synthetic samples, never patient rows; vendor placeholders marked.
    const pv = (await as(AP, (db) => getTemplate(db, lg.templateId))).versions[0].preview;
    expect(pv).toContain("PT Klinik Surat Sintetis");
    expect(pv).not.toContain("{{");
    const lp = (await as(FH, (db) => getTemplate(db, tplId))).versions[0].preview;
    expect(lp).toContain("Pasien Contoh (RM-CONTOH)");
    expect(lp).not.toMatch(/Pasien Rahasia/);
  });

  it("roles: owner and admin pusat every kind; facility head consent and letter; doctor reads letter templates only", async () => {
    const receipt = "{{klinik.nama}} {{cabang.alamat}} NPWP {{klinik.npwp}} No {{struk.nomor}} {{tanggal}} {{struk.baris}} Total {{struk.total}}";
    const r = await as(OWN, (db) => saveTemplate(db, key(), null, { kind: "receipt", name: "Struk Pemilik", body: receipt, paper: "80mm" }));
    expect(await code(as(FH, (db) => saveTemplate(db, key(), null, { kind: "receipt", name: "Struk FH", body: receipt, paper: "80mm" })))).toBe("ERR_FORBIDDEN");
    expect(await code(as(FH, (db) => saveTemplate(db, key(), r.templateId, { body: receipt, paper: "80mm" })))).toBe("ERR_FORBIDDEN");
    expect(await code(as(FH, (db) => getTemplate(db, r.templateId)))).toBe("ERR_NOT_FOUND");
    for (const who of [DOC, NUR, FO, MGR, RO]) {
      expect(await code(as(who, (db) => saveTemplate(db, key(), null, { kind: "letter", letterType: "resume", name: "Coba", body: LETTER, paper: "a4" }))), who.role).toBe("ERR_FORBIDDEN");
    }
    const kinds = async (who: P) => [...new Set((await as(who, (db) => listTemplates(db, null))).templates.map((x) => x.kind))].sort();
    expect(await kinds(OWN)).toEqual(expect.arrayContaining(["letter", "receipt"]));
    expect(await kinds(FH)).not.toContain("receipt");
    expect(await kinds(DOC)).toEqual(["letter"]);
    expect(await code(as(DOC, (db) => getTemplate(db, r.templateId)))).toBe("ERR_NOT_FOUND");
    expect((await as(DOC, (db) => getTemplate(db, tplId))).writable).toBe(false);
    for (const who of [NUR, FO, MGR, RO]) expect(await code(as(who, (db) => listTemplates(db, null))), who.role).toBe("ERR_FORBIDDEN");
    // Direct reads through RLS follow the same kinds.
    const direct = (who: P) => as(who, async (db) => (await db.query(`select count(*)::int as n from document_template_versions v where v.template_id = $1`, [r.templateId])).rows[0].n as number);
    expect([await direct(OWN), await direct(AP), await direct(FH), await direct(DOC), await direct(NUR)]).toEqual([1, 1, 0, 0, 0]);
  });
});

describe("letters: authorship, examination, options, readers", () => {
  it("the examining doctor writes the letter; without an examination any doctor of the branch; '-' when no SIP", async () => {
    const pid = await patient(A);
    const v = await visit(A, pid);
    const { examId } = await as(DOC, (db) => openExam(db, key(), v));
    expect(examId).toBeTruthy();
    expect(await reason(as(DOC2, (db) => createLetter(db, key(), v, tplVersion)))).toMatch(/only the examining doctor/);
    const opts = await as(DOC2, (db) => letterOptions(db, v));
    expect(opts.visits[0]).toMatchObject({ visit_id: v, examined_by_other: true });
    const v2 = await visit(A, await patient(A));
    const { letterId } = await as(DOC2, (db) => createLetter(db, key(), v2, tplVersion));
    const l = await as(DOC2, (db) => getLetter(db, letterId));
    expect(l.body).toContain("SIP -");
    expect(l.body).toContain("Keluhan: -");
    // Only its author changes it; another doctor reads it.
    expect(await reason(as(DOC, (db) => saveLetter(db, key(), letterId, "Isi yang diubah dokter lain")))).toMatch(/only the doctor who wrote/);
    expect(await code(as(DOC, (db) => signLetter(db, key(), letterId, STEP)))).toBe("ERR_FORBIDDEN");
    expect((await as(DOC, (db) => getLetter(db, letterId))).own).toBe(false);
    // Other branch, roles, unresolved placeholders, closed visits.
    expect(await code(as(DOCB2, (db) => createLetter(db, key(), v2, tplVersion)))).toBe("ERR_NOT_FOUND");
    for (const who of [NUR, FH, RO, FO]) expect(await code(as(who, (db) => createLetter(db, key(), v2, tplVersion))), who.role).toBe("ERR_FORBIDDEN");
    expect(await reason(as(DOC2, (db) => saveLetter(db, key(), letterId, "Isi dengan {{pasien.nama}} tersisa")))).toBe("unresolved_placeholder");
    const v3 = (await h.admin.query(
      `insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by, checked_in_at) values ($1, $2, $3, 'walk_in', $4, now() - interval '3 days') returning id`,
      [A.tenantId, A.b1, await patient(A), FO.staffId])).rows[0].id as string;
    await h.admin.query(`update visits set closed_at = now() - interval '2 days', closed_by = checked_in_by where id = $1`, [v3]);
    expect(await reason(as(DOC, (db) => createLetter(db, key(), v3, tplVersion)))).toBe("visit_closed");
    // Lists: the doctor's own recent letters; the visit's letters.
    expect((await as(DOC2, (db) => listLetters(db))).letters.map((x) => x.id)).toContain(letterId);
    expect((await as(DOC, (db) => listLetters(db))).letters.map((x) => x.id)).not.toContain(letterId);
    expect((await as(DOC, (db) => listLetters(db, { visitId: v2 }))).letters.map((x) => x.id)).toEqual([letterId]);
    // Second factor required at signing.
    const noTotp = await person(A, "doctor", A.b1);
    await h.admin.query(`update auth_user set two_factor_enabled = false where id = $1`, [noTotp.acc]);
    const v4 = await visit(A, await patient(A));
    const nl = await as(noTotp, (db) => createLetter(db, key(), v4, tplVersion));
    expect(await reason(as(noTotp, (db) => signLetter(db, key(), nl.letterId, STEP)))).toBe("second_factor_required");
  });

  it("the active branch binds: a doctor of two branches, SIP of the branch only and verified; template reads need the role at the branch", async () => {
    const both = await person(A, "doctor", A.b1, A.b2);
    // SIP verified at b2 only, and a pending one at b1: neither fills b1's letter.
    await sip(A, both, A.b2, "SIP-B2-ONLY");
    await h.admin.query(`insert into staff_credentials (tenant_id, staff_id, kind, number, issuer, profession, branch_id, valid_from, expires_on, recorded_by)
                         values ($1, $2, 'sip', 'SIP-PENDING-B1', 'Dinas Kesehatan', 'dokter', $3, '2024-01-01', '2099-12-31', $4)`, [A.tenantId, both.staffId, A.b1, OWN.staffId]);
    const v = await visit(A, await patient(A));
    const { letterId } = await as(both, (db) => createLetter(db, key(), v, tplVersion));
    const l = await as(both, (db) => getLetter(db, letterId));
    expect(l.body).toContain("SIP -");
    // Acting at b2 (b1 still allowed in the session): b1's letter is neither read nor changed.
    const atB2 = await resolveContext(app, both.acc, { tenantId: A.tenantId, actingRole: "doctor", activeBranchId: A.b2 });
    const wide = { ...atB2, allowedBranchIds: [A.b2, A.b1] };
    expect(await code(withTenantContext(app, wide, (db) => getLetter(db, letterId)))).toBe("ERR_NOT_FOUND");
    expect(await code(withTenantContext(app, wide, (db) => saveLetter(db, key(), letterId, "Isi diubah dari cabang lain")))).toBe("ERR_NOT_FOUND");
    // Template reads by RLS need the acting role at the active branch, not at another branch the staff still holds.
    const two = await person(A, "doctor", A.b1, A.b2);
    const twoB2 = await resolveContext(app, two.acc, { tenantId: A.tenantId, actingRole: "doctor", activeBranchId: A.b2 });
    const readTpl = () => withTenantContext(app, twoB2, async (db) => (await db.query(`select count(*)::int as n from document_templates where id = $1`, [tplId])).rows[0].n as number);
    expect(await readTpl()).toBe(1);
    await h.admin.query(`delete from staff_branches where staff_id = $1 and branch_id = $2`, [two.staffId, A.b2]);
    expect(await readTpl()).toBe(0);
    // A stale session with no branch role left reads nothing.
    const gone = await person(A, "doctor", A.b2);
    const goneCtx = await resolveContext(app, gone.acc, { tenantId: A.tenantId, actingRole: "doctor", activeBranchId: A.b2 });
    await h.admin.query(`delete from staff_branches where staff_id = $1`, [gone.staffId]);
    expect(await withTenantContext(app, goneCtx, async (db) => (await db.query(`select count(*)::int as n from document_templates where id = $1`, [tplId])).rows[0].n)).toBe(0);
    // A closed tenant has neither configuration nor clinical_read.
    await h.admin.query(`update tenants_registry set lifecycle_state = 'closed' where id = $1`, [A.tenantId]);
    try {
      expect(await code(as(AP, (db) => listTemplates(db, null)))).toBe("ERR_TENANT_SUSPENDED");
    } finally {
      await h.admin.query(`update tenants_registry set lifecycle_state = 'live' where id = $1`, [A.tenantId]);
    }
  });

  it("exit: letters read, never written; onboarding: templates configured", async () => {
    const pid = await patient(A);
    const v = await visit(A, pid);
    const { letterId } = await as(DOC, (db) => createLetter(db, key(), v, tplVersion));
    await h.admin.query(`update tenants_registry set lifecycle_state = 'exit' where id = $1`, [A.tenantId]);
    try {
      expect((await as(RO, (db) => getLetter(db, letterId))).state).toBe("draft");
      expect(await code(as(DOC, (db) => saveLetter(db, key(), letterId, "Isi saat keluar layanan")))).toBe("ERR_TENANT_SUSPENDED");
      expect(await code(as(DOC, (db) => createLetter(db, key(), v, tplVersion)))).toBe("ERR_TENANT_SUSPENDED");
      expect(await code(as(AP, (db) => saveTemplate(db, key(), tplId, { body: LETTER, paper: "a4" })))).toBe("ERR_TENANT_SUSPENDED");
    } finally {
      await h.admin.query(`update tenants_registry set lifecycle_state = 'live' where id = $1`, [A.tenantId]);
    }
    const on = await tenant("onboarding");
    const ap = await person(on, "admin_pusat");
    const t = await as(ap, (db) => saveTemplate(db, key(), null, { kind: "letter", letterType: "resume", name: "Resume Medis", body: LETTER, paper: "a4" }));
    expect((await as(ap, (db) => listTemplates(db, "letter"))).templates.map((x) => x.id)).toEqual([t.templateId]);
  });
});

describe("guards, helpers, support classes, cross-tenant", () => {
  it("nothing deleted; versions fixed; used_at set once; retire one way; letters frozen after signing; triggers always", async () => {
    const t = await as(AP, (db) => saveTemplate(db, key(), null, { kind: "letter", letterType: "resume", name: "Resume Guard", body: LETTER, paper: "a4" }));
    await expect(h.admin.query(`delete from document_templates where id = $1`, [t.templateId])).rejects.toThrow(/never deleted/);
    await expect(h.admin.query(`update document_template_versions set body = body || ' x' where id = $1`, [t.versionId])).rejects.toThrow(/fixed once saved/);
    await expect(h.admin.query(`update document_template_versions set state = state where id = $1`, [t.versionId])).rejects.toThrow(/fixed once saved/);
    await h.admin.query(`update document_template_versions set used_at = now() where id = $1`, [t.versionId]);
    await expect(h.admin.query(`update document_template_versions set used_at = now() + interval '1 day' where id = $1`, [t.versionId])).rejects.toThrow(/fixed once saved/);
    await h.admin.query(`update document_template_versions set state = 'retired' where id = $1`, [t.versionId]);
    await expect(h.admin.query(`update document_template_versions set state = 'active' where id = $1`, [t.versionId])).rejects.toThrow(/fixed once saved/);
    await expect(h.admin.query(`update document_templates set name = 'Ganti Nama' where id = $1`, [t.templateId])).rejects.toThrow(/only retires/);
    await expect(h.admin.query(`update document_templates set name = 'Ganti Nama', state = 'retired', retired_at = now(), retired_by = $2, retired_as = 'admin_pusat' where id = $1`,
      [t.templateId, AP.staffId])).rejects.toThrow(/only retires/);
    await expect(h.admin.query(
      `insert into document_template_versions (tenant_id, template_id, kind, version, body, paper, created_by, created_as, used_at) values ($1, $2, 'letter', 9, $3, 'a4', $4, 'admin_pusat', now())`,
      [A.tenantId, t.templateId, LETTER, AP.staffId])).rejects.toThrow(/first state/);
    const v = await visit(A, await patient(A));
    const { letterId } = await as(DOC, (db) => createLetter(db, key(), v, tplVersion));
    await expect(h.admin.query(`update medical_letters set author_id = $2 where id = $1`, [letterId, DOC2.staffId])).rejects.toThrow(/keeps its visit/);
    await expect(h.admin.query(`delete from medical_letters where id = $1`, [letterId])).rejects.toThrow(/never deleted/);
    for (const x of TABLES) await expect(h.admin.query(`truncate ${x} cascade`)).rejects.toThrow();
    // As migrated (read in beforeAll): every guard and the approval sync fire always, also for a replica session.
    expect(triggersAtStart.map((r) => `${r.tgname}:${r.tgenabled}`)).toHaveLength(11);
    expect(triggersAtStart.every((r) => r.tgenabled === "A"), JSON.stringify(triggersAtStart)).toBe(true);
  });

  it("support classes; helpers not executable; cross-tenant reads and writes nothing", async () => {
    const kinds = (await h.admin.query(`select table_name, support_class from support_object_kinds where table_name = any($1::text[]) order by 1`, [TABLES.map((x) => `public.${x}`)])).rows;
    expect(kinds.map((k) => `${k.table_name}:${k.support_class}`).sort()).toEqual([
      "public.document_template_versions:config", "public.document_templates:config", "public.medical_letter_corrections:clinical",
      "public.medical_letter_versions:clinical", "public.medical_letters:clinical"]);
    for (const f of ["documents_guard()", "template_placeholders(text)", "template_check(text,text,text)", "template_fill(text,jsonb)", "letter_values(uuid,uuid,uuid)",
      "letter_hash(text)", "letter_current(uuid,uuid)", "template_actor(text)", "letter_actor()", "letter_own(record,uuid)", "letter_body_ok(text)",
      "letter_write_version(medical_letters,text,text,uuid,text,uuid)", "letter_correction_sync()", "template_reader()", "letter_reader()", "letter_row(medical_letters)"]) {
      for (const r of ["clinic_app", "clinic_vendor", "clinic_operator"]) {
        expect((await h.admin.query(`select has_function_privilege($1, $2, 'execute') as ok`, [r, `public.${f}`])).rows[0].ok, `${r} ${f}`).toBe(false);
      }
    }
    const v = await visit(A, await patient(A));
    const { letterId } = await as(DOC, (db) => createLetter(db, key(), v, tplVersion));
    for (const x of TABLES) expect(await as(BDOC, async (db) => (await db.query(`select count(*)::int as n from ${x}`)).rows[0].n), x).toBe(0);
    expect(await as(BAP, async (db) => (await db.query(`select count(*)::int as n from document_templates`)).rows[0].n)).toBe(0);
    expect(await code(as(BAP, (db) => getTemplate(db, tplId)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BAP, (db) => saveTemplate(db, key(), tplId, { body: LETTER, paper: "a4" })))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BAP, (db) => retireTemplate(db, key(), tplId)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BDOC, (db) => createLetter(db, key(), v, tplVersion)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BDOC, (db) => getLetter(db, letterId)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BDOC, (db) => saveLetter(db, key(), letterId, "Isi lintas tenant")))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BDOC, (db) => signLetter(db, key(), letterId, STEP)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BDOC, (db) => correctLetter(db, key(), letterId, "Isi lintas tenant", "Alasan")))).toBe("ERR_NOT_FOUND");
    expect((await as(BDOC, (db) => listLetters(db, { visitId: v }))).letters).toEqual([]);
    expect((await as(BDOC, (db) => letterOptions(db, v))).visits).toEqual([]);
  });
});
